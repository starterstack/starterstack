#!/usr/bin/env node

import process from 'node:process'
import { promisify } from 'node:util'
import inquirer from 'inquirer'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import path from 'node:path'
import os from 'node:os'
import { spawn as nativeSpawn, exec } from 'node:child_process'
import { once } from 'node:events'
import { ListTablesCommand } from '@aws-sdk/client-dynamodb'
import deployStrategy from '../.github/actions/deploy-strategy.js'

import ora from 'ora'

const windows = os.platform() === 'win32'

console.log(
  '\u001B[93mGitHub is the recommended way to deploy, only use this script if you have to\u001B[0m'
)

try {
  const ps = spawn('command', ['-v', 'aws'])
  await once(ps, 'close')
  if (ps.exitCode !== 0) {
    throw new Error('missing aws')
  }
} catch {
  console.error('\u001B[91mmissing aws cli\u001B[0m')
  console.log(
    '\u001B[90msee https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html\u001B[0m'
  )
  process.exit(0)
}

if (!process.env.AWS_ACCESS_KEY_ID) {
  console.error('\u001B[91mmissing aws credentials\u001B[0m')
  process.exit(1)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const settings = JSON.parse(
  await readFile(new URL('../packages/settings.json', import.meta.url))
)

const sts = new STSClient({ region: 'us-east-1' })
const { Account: accountId } = await sts.send(new GetCallerIdentityCommand())

const awsAccount = settings.awsAccounts[accountId]

if (!awsAccount) {
  console.error(
    `\u001B[91maccount ${accountId} not found in ../packages/settings.json\u001B[0m`
  )
  process.exit(0)
}

process.once('exit', () => cursor(true))
process.once('SIGINT', () => cursor(true))

cursor(false)

const { region, stage } = await getStage()

const output = {}

cursor(true)

const { removeOrDeploy } = await inquirer.prompt({
  type: 'confirm',
  name: 'removeOrDeploy',
  default: false,
  message: `remove ${stage}`
})

const { removePrompt } =
  removeOrDeploy &&
  (await inquirer.prompt({
    type: 'input',
    name: 'removePrompt',
    message: 'type "permanently delete" to remove'
  }))

if (removeOrDeploy && removePrompt !== 'permanently delete') {
  process.exit(0)
}

const remove = removeOrDeploy && removePrompt === 'permanently delete'

if (removePrompt && !remove) {
  process.exit(0)
}

cursor(false)

const loadingDeployments = ora({
  text: `get deployment strategy for stage ${stage}`,
  color: 'gray'
}).start()

await deployStrategy({
  core: {
    setOutput(name, value) {
      output[name] = value
    }
  },
  remove,
  stage,
  nodePath: 'node',
  region,
  npmCacheHit: false
})

loadingDeployments.stop()

if (
  [
    'ordered',
    'parallel-stage',
    'parallel-backend',
    'parallel-frontend',
    'parallel-remaining'
  ].every((deployType) => !output[deployType])
) {
  console.log('\u001B[32meverything up-to-date\u001B[0m')
  process.exit(0)
}

const strategy = [
  'ordered',
  'parallel-stage',
  'parallel-backend',
  'parallel-frontend',
  'parallel-remaining'
]

if (remove) {
  strategy.shift()
  strategy.reverse()
}

console.log(
  `\u001B[90mwill ${remove ? 'remove' : 'deploy'} ${strategy
    .flatMap((deployType) =>
      output[`${deployType}-strategy`]?.matrix?.include.map(
        (x) => `${x.stack}(${x.region})`
      )
    )
    .filter(Boolean)
    .join(', ')} to ${stage}\u001B[0m`
)

cursor(true)

if (!stage.startsWith('pr-')) {
  const { run } = await inquirer.prompt({
    type: 'confirm',
    name: 'run',
    default: false,
    message: `It's recommended to use GitHub actions, continue with ${
      remove ? 'removal of' : 'deployment to'
    } stage ${stage}`
  })

  if (!run) {
    process.exit(0)
  }
}

for (const type of strategy) {
  if (output[type]) {
    const deployment = output[`${type}-strategy`]
    const include = [...deployment.matrix.include]
    const parallel = deployment['max-parallel']
    console.log(
      `\u001B[90m${remove ? 'remove' : 'deploy'} ${type} ${include
        .map((x) => x.stack)
        .join(', ')}\u001B[0m`
    )
    for (const batch of batchFor({ include, parallel })) {
      const processes = batch.map((service) =>
        createDeployProcess(service, remove)
      )
      const pendingExitCodes = Promise.all(
        processes.map(({ ps }) => once(ps, 'exit'))
      )
      await Promise.all(
        processes.flatMap(({ ps, stack, region }) =>
          ['stdout', 'stderr'].map((stream) =>
            pipe({ ps, stream, stack, region })
          )
        )
      )
      for (const [code, signal] of await pendingExitCodes) {
        if (code === null) {
          throw new Error(`failed, process was killed by signal ${signal}`)
        } else if (code !== 0) {
          throw new Error(`failed, process exited with code ${code}`)
        }
      }
    }
  }
}

async function pipe({ ps, stream, stack, region }) {
  for await (const chunk of ps[stream]) {
    for (const line of chunk.toString().split(/[\n\r]/)) {
      if (line.trim().length > 0) {
        console.log(`\u001B[0m${stack}(${region}) ${line}`)
      }
    }
  }
}

async function assertStageDeployed(stage, region) {
  process.env.AWS_REGION = region
  process.env.AWS_DEFAULT_REGION = region
  const { default: dynamodb } = await import(
    path.join(__dirname, '..', 'packages', 'shared', 'dynamodb.js')
  )

  const { TableNames: tableNames = [] } = await dynamodb.send(
    new ListTablesCommand({})
  )

  if (
    !tableNames.some(function findPullRequestStackTable(table) {
      return table.includes(stage)
    })
  ) {
    console.error(`\u001B[91mno ${stage} environment found\u001B[0m`)
    process.exit(0)
  }
}

async function getStage() {
  if (settings.accountPerStage && awsAccount.stage === 'feature') {
    const loadingStage = ora({ text: 'get stage', color: 'gray' }).start()
    const ref = await getPullRequestRef()
    const stage = `pr-${ref}`
    const region = settings.regions[awsAccount.stage]

    await assertStageDeployed(stage, region)
    loadingStage.stop()
    return {
      region,
      stage
    }
  } else {
    const { stage } = settings.accountPerStage
      ? { stage: awsAccount.stage }
      : await inquirer.prompt({
          type: 'list',
          name: 'stage',
          choices: settings.stages,
          message: 'region'
        })

    const region = settings.regions[stage]

    if (stage === 'feature') {
      const loadingStage = ora({ text: 'get stage', color: 'gray' }).start()
      const ref = await getPullRequestRef()
      const prStage = `pr-${ref}`
      await assertStageDeployed(prStage, region)
      loadingStage.stop()
      return {
        region,
        stage: prStage
      }
    } else {
      return { region, stage }
    }
  }
}

async function getPullRequestRef() {
  const run = promisify(exec)

  try {
    const { stdout } = await run(`
      git ls-remote --refs origin | \
      grep $(git rev-parse @{push}) | \
      grep -oE 'pull/[0-9]+' | \
      sed 's|^pull/||g'`)
    const ref = stdout.replaceAll(/[\n\r]/g, '')
    if (ref) {
      return Number(ref)
    }
  } catch {
    // eslint-disable-next-line no-empty
  }
  console.error('\u001B[91mno pull request found\u001B[0m')
  process.exit(0)
}

function spawn(cmd, args, options) {
  if (windows) {
    args = [
      '/C',
      cmd,
      ...args.map((arg) => {
        return typeof arg === 'string' ? arg.replaceAll('^', '^^^^') : arg
      })
    ]
    cmd = 'cmd'
  }
  return nativeSpawn(cmd, args, options)
}

function cursor(show) {
  if (show) {
    process.stdout.write('\u001B[?25h')
  } else {
    process.stderr.write('\u001B[?25l')
  }
}

function createDeployProcess(service, remove) {
  return {
    ps: spawn(
      'bash',
      [
        path.join(__dirname, '..', 'scripts', 'sam.sh'),
        service.stage,
        service.region,
        service['package-lock'].toString(),
        remove.toString()
      ],
      {
        cwd: service.directory,
        shell: true,
        env: {
          FORCE_COLOR: '1',
          NODE_OPTIONS: '--unhandled-rejections=strict',
          ...process.env,
          INIT_CWD: undefined,
          PATH: `${process.env.PATH}:${path.resolve(
            path.join(__dirname, '..', 'node_modules', '.bin')
          )}`,
          ...(windows && {
            MSYSTEM: `mingw${os.arch() === 'x64' ? '64' : '32'}`
          })
        }
      }
    ),
    stack: service.stack,
    region: service.region
  }
}

function* batchFor({ include, parallel }) {
  const pending = [...include]
  while (pending.length > 0) {
    const batch = pending.splice(0, parallel)
    if (batch.length === 1) {
      yield batch
    } else {
      const result = []
      for (const item of batch) {
        const directory = item.directory
        const directoryItems = batch.filter((x) => x.directory === directory)
        if (directoryItems.length > 1) {
          for (const directoryItem of directoryItems) {
            yield [directoryItem]
          }
        } else {
          result.push(item)
        }
      }
      if (result.length > 0) {
        yield result
      }
    }
  }
}
