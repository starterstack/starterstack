#!/usr/bin/env node

import process from 'node:process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { spawn as nativeSpawn } from 'node:child_process'
import { once } from 'node:events'
import deployStrategy from '../.github/actions/deploy-strategy.js'

for (const key of [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE'
]) {
  delete process.env[key]
}

import ora from 'ora'

const windows = os.platform() === 'win32'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.once('exit', () => cursor(true))
process.once('SIGINT', () => cursor(true))

cursor(false)

const region = 'us-east-1'
const stage = 'local'

const output = {}

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
  remove: false,
  stage,
  nodePath: 'node',
  region,
  npmCacheHit: false,
  lintOnly: true
})

loadingDeployments.stop()

const strategy = [
  'ordered',
  'parallel-stage',
  'parallel-backend',
  'parallel-frontend',
  'parallel-remaining'
]

cursor(true)

for (const type of strategy) {
  if (output[type]) {
    const deployment = output[`${type}-strategy`]
    const include = [...deployment.matrix.include]
    const parallel = deployment['max-parallel']
    console.log(
      `\u001B[90m lint ${type} ${include
        .map((x) => x.stack)
        .join(', ')}\u001B[0m`
    )
    for (const batch of batchFor({ include, parallel })) {
      const processes = batch.map((service) => createLintProcess(service))
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

function createLintProcess(service) {
  return {
    ps: spawn(
      'bash',
      [
        path.join(__dirname, '..', 'scripts', 'sam.sh'),
        service.stage,
        service.region,
        service['package-lock'].toString(),
        'false',
        'true'
      ],
      {
        cwd: service.directory,
        shell: true,
        env: {
          IS_OFFLINE: 'true',
          FORCE_COLOR: '1',
          NODE_OPTIONS: '--unhandled-rejections=strict',
          ...process.env,
          INIT_CWD: path.resolve(service.directory),
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
