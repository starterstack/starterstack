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

import { getConfig as stackStageConfig } from './stack-stage-config.mjs'

const require = createRequire(import.meta.url)

const { regions, accountPerStage } = require('./settings.json')

export default async function deployStrategy({
  github,
  core,
  stage,
  remove,
  npmCacheHit
}) {
  const awsRegions = [
    ...new Set(['us-east-1', 'eu-west-1', ...Object.values(regions)])
  ]
  const strategy = {
    only:
      {
        log: ['deployment', 'iam', 'monitoring', 'cloudtrail', 'budget'],
        backup: [
          'deployment',
          'iam',
          'monitoring',
          'cloudtrail',
          'backup',
          'eventbus',
          'budget'
        ]
      }[stage] ?? [],
    order: remove
      ? ['deployment', 'iam', 'monitoring', 'stack', 'region']
      : [
          'deployment',
          'iam',
          'monitoring',
          'stack',
          'region',
          'dynamodb'
          // 'cloudfront-us-east-1'
        ],
    stage: remove
      ? // ? ['cdn', 'eventbus', 'dynamodb', 'cloudfront-us-east-1']
        // : ['cdn', 'eventbus'],
        ['eventbus', 'dynamodb']
      : ['eventbus'],
    // backend: ['rest', 'websocket', 'graphql', 'ses']
    backend: []
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
    Promise.all(strategy.order.flatMap(calculateStackChanges)),
    Promise.all(strategy.stage.flatMap(calculateStackChanges)),
    Promise.all(strategy.backend.flatMap(calculateStackChanges)),
    Promise.all(strategy.remaining.flatMap(calculateStackChanges))
  ])

  async function calculateStackChanges(name) {
    if (name === 'backup' && !accountPerStage) {
      return
    }
    if (strategy.only.length > 0 && !strategy.only.includes(name)) {
      return
    }

    try {
      if (!(await fs.lstat(path.join('packages', name))).isDirectory()) {
        return
      }
    } catch (e) {
      console.error(e)
      return
    }
    const stackConfigPath = path.join('packages', name, 'template.yaml')
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

    const config = await stackStageConfig({
      stage,
      directory: stackDirectory
    })

    const result = []

    const stackName = config.stackName
    const stackStage = config.stage

    for (const stackRegion of config.regions) {
      try {
        const deployedSha = deployed[stackRegion]?.get(
          `${stackName}DeployedCommit`
        )

        if (remove && !deployedSha) {
          continue
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
              continue
            }
          }
        }
      } catch (e) {
        if (github) {
          console.error(e)
        }
        if (remove) {
          continue
        }
      }

      result.push({
        stack: name,
        stage: stackStage,
        region: stackRegion,
        directory: stackDirectory,
        'package-lock': hasPackageLock
      })
    }

    return result
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
    for (const value of changes.flat().filter(Boolean)) {
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
