import jsYaml from 'js-yaml'
import schema from '@serverless/utils/cloudformation-schema.js'
import process from 'node:process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { exec } from 'node:child_process'
import calculateStackHash from './directory-hash.mjs'
import {
  CloudFormationClient,
  ListExportsCommand
} from '@aws-sdk/client-cloudformation'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const { regions, accountPerStage, stackName } = require('./settings.json')

export default async function deployStrategy({
  github,
  core,
  stage,
  region,
  remove,
  npmCacheHit
}) {
  const awsRegions = [
    ...new Set(['us-east-1', 'eu-west-1', ...Object.values(regions)])
  ]
  const strategy = {
    only:
      {
        log: ['iam', 'monitoring', 'cloudtrail', 'budget'],
        backup: [
          'iam',
          'monitoring',
          'cloudtrail',
          'backup',
          'eventbus',
          'budget'
        ]
      }[stage] ?? [],
    order: remove
      ? ['iam', 'monitoring', 'stack', 'region']
      : [
          'iam',
          'monitoring',
          'stack',
          'region',
          'dynamodb',
          'cloudfront-us-east-1'
        ],
    stage: remove
      ? ['cdn', 'eventbus', 'dynamodb', 'cloudfront-us-east-1']
      : ['cdn', 'eventbus'],
    backend: ['rest', 'websocket', 'graphql', 'ses']
  }

  const deployed = await listDeployed(awsRegions)

  strategy.remaining = (await fs.readdir('packages')).filter(
    (file) =>
      !file.includes('.') &&
      !strategy.order.includes(file) &&
      !strategy.backend.includes(file) &&
      !strategy.stage.includes(file)
  )

  const calculateChanges = await Promise.all([
    Promise.all(strategy.order.map(calculateStackChanges)),
    Promise.all(strategy.stage.map(calculateStackChanges)),
    Promise.all(strategy.backend.map(calculateStackChanges)),
    Promise.all(strategy.remaining.map(calculateStackChanges))
  ])

  async function calculateStackChanges(name) {
    if (name === 'backup' && !accountPerStage) {
      return
    }
    if (strategy.only.length > 0 && !strategy.only.includes(name)) {
      return
    }
    if (!(await fs.lstat(path.join('packages', name))).isDirectory()) {
      return
    }
    const stackConfigPath = path.join('packages', name, 'serverless.yml')
    const packageLockPath = path.join('packages', name, 'package-lock.json')
    const stackDirectory = path.dirname(stackConfigPath)
    if (!(await fs.stat(stackConfigPath).catch((_) => false))) return

    const hasPackageLock = !!(await fs
      .stat(packageLockPath)
      .catch((_) => false))

    if (hasPackageLock && !npmCacheHit) {
      await execCommand(
        `npm install --no-save --audit false --fund false --ignore-scripts # ${stackDirectory}`,
        stackDirectory
      )
    }

    const overrideRegionMatch = /region:\s*['"]?([a-z-\d]+)['"]?/
    const overrideStageMatch = /stage:\s*['"]?([a-z-_\d]+)['"]?/

    const useStageOption = /stage:\s*\$\{opt:\s*stage\}/
    const useRegionOption = /region:\s*\$\{opt:\s*region\}/

    const stackConfig = await fs.readFile(stackConfigPath, 'utf-8')
    const stackRegion =
      overrideRegionMatch.test(stackConfig) &&
      !useRegionOption.test(stackConfig)
        ? stackConfig.match(overrideRegionMatch)[1]
        : region
    const stackStage =
      overrideStageMatch.test(stackConfig) &&
      !useStageOption.test(stackConfigPath)
        ? stackConfig.match(overrideStageMatch)[1]
        : stage
    try {
      const stack = await jsYaml.load(stackConfig, { schema })
      const providerStackName = replaceStackName(stack.provider?.stackName)
      const serviceStackName = `${replaceStackName(
        stack.service
      )}-${stackStage}`
      const stackName = providerStackName ?? serviceStackName

      const deployedSha = deployed[stackRegion]?.get(
        `${stackName}DeployedCommit`
      )

      if (remove && !deployedSha) {
        return
      }

      if (deployedSha) {
        if (!remove) {
          try {
            // these diffs will exit 1 only if there are changes, hense the catch
            await Promise.all([
              execCommand(
                `git diff ${deployedSha} -s --exit-code -- . ':!src/local-http-mock/*'`,
                stackDirectory
              ),
              execCommand(
                `git diff ${deployedSha} -s --exit-code -- ./packages/*.*`
              ),
              execCommand(
                `git diff ${deployedSha} -s --exit-code -- ./packages/shared ':!packages/shared/test' ':!packages/shared/package.json'`
              )
            ])
            return
          } catch {}
          const deployedHash = deployed[stackRegion]?.get(
            `${stackName}DeployedHash`
          )

          const localHash = await calculateStackHash({
            root: stackDirectory,
            packagesRoot: path.join(process.cwd(), 'packages')
          })

          if (deployedHash && deployedHash === localHash) {
            return
          }
        }
      }
    } catch (e) {
      if (github) {
        console.error(e)
      }
      if (remove) {
        return
      }
    }
    return {
      stack: name,
      stage: stackStage,
      region: stackRegion,
      directory: stackDirectory,
      'package-lock': hasPackageLock
    }
  }

  const strategyResult = {
    ordered: {
      'max-parallel': 1,
      matrix: {
        include: []
      }
    },
    'parallel-backend': {
      'max-parallel': 7,
      'fail-fast': false,
      matrix: {
        include: []
      }
    },
    'parallel-stage': {
      'max-parallel': 7,
      'fail-fast': false,
      matrix: {
        include: []
      }
    },
    'parallel-remaining': {
      'max-parallel': 7,
      'fail-fast': false,
      matrix: {
        include: []
      }
    }
  }

  core.setOutput('aws-regions', awsRegions.join(' '))

  for (const [type, changes] of Object.entries({
    ordered: calculateChanges[0],
    'parallel-stage': calculateChanges[1],
    'parallel-backend': calculateChanges[2],
    'parallel-remaining': calculateChanges[3]
  })) {
    for (const value of changes.filter(Boolean)) {
      if (remove && value.stage === 'global') {
        continue
      } else {
        strategyResult[type].matrix.include.push(value)
      }
    }
    if (remove) {
      strategyResult[type].matrix.include.reverse()
    } else {
      if (
        strategyResult[type].matrix.include.find((x) => x.stack === 'dynamodb')
      ) {
        core.setOutput('db-changed', true)
      }
    }
    core.setOutput(type, strategyResult[type].matrix.include.length > 0)
    core.setOutput(`${type}-strategy`, strategyResult[type])
    if (github) {
      console.log(
        '%s %s %s',
        remove ? 'remove' : 'deploy',
        type,
        strategyResult[type].matrix.include.map(({ stack }) => stack).join(',')
      )
    }
  }
}

async function execCommand(command, stackDirectory) {
  const { stdout } = await promisify(exec)(command, {
    ...(stackDirectory && {
      cwd: stackDirectory
    }),
    env: {
      ...process.env,
      PATH: `${process.env.PATH}:../../node_modules/.bin`
    }
  })
  return stdout.replace(/[\r\n]/g, '').trim()
}

async function listDeployed(regions) {
  const deployed = {}
  await Promise.all(regions.map(listForRegion))
  return deployed

  async function listForRegion(region) {
    const map = new Map()
    deployed[region] = map
    const cloudformation = new CloudFormationClient({ region })
    let nextToken
    while (true) {
      const result = await cloudformation.send(
        new ListExportsCommand({
          ...(nextToken && { NextToken: nextToken })
        })
      )

      for (const { Name: key, Value: value } of result.Exports.filter(
        (x) =>
          x.Name.endsWith('DeployedHash') || x.Name.endsWith('DeployedCommit')
      )) {
        map.set(key, value)
      }

      nextToken = result.NextToken
      if (!nextToken) break
    }
  }
}
function replaceStackName(name) {
  /* eslint-disable-next-line no-template-curly-in-string */
  return name?.replace('${file(../settings.js):stackName}', stackName)
}
