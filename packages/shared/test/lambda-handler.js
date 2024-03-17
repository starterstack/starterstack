import process from 'node:process'
import { Buffer } from 'node:buffer'
import handler, { prefix } from '../lambda-handler.js'
import { setTimeout } from 'node:timers/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn as nativeSpawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { writeFile, unlink } from 'node:fs/promises'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env._X_AMZN_TRACE_ID = 'Root=<tap test>;Parent=x;Sampled=1'
process.env.GIT_COMMIT = 'git commit'

const defaultContext = {
  awsRequestId: 'awsRequestId',
  functionName: 'tap tests',
  logGroupName: 'logGroupName',
  logStreamName: 'logStreamName',
  getRemainingTimeInMillis: () => 51
}

await test('first call (anonymous/sampled)', async () => {
  Math.random = () => 0.05
  const correlationIds = await handler(function (
    _event,
    _context,
    { correlationIds }
  ) {
    return correlationIds
  })(
    {
      requestContext: {
        requestId: 'requestId'
      }
    },
    {
      ...defaultContext
    }
  )
  assert.deepEqual(correlationIds, {
    'x-correlation-api-id': 'requestId',
    'x-correlation-call-chain-length': 1,
    'x-correlation-debug-log-enabled': true,
    'x-correlation-git-commit': 'git commit',
    'x-correlation-id': 'awsRequestId',
    'x-correlation-lambda': 'tap tests',
    'x-correlation-log-stream': 'logGroupName/logStreamName',
    'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
    'x-correlation-user-id': undefined
  })
})

await test('eventbridge correlationIds', async () => {
  Math.random = () => 0.05
  const correlationIds = await handler(function (
    _event,
    _context,
    { correlationIds }
  ) {
    return correlationIds
  })(
    {
      detail: {
        correlationIds: {
          [`${prefix.correlationPrefix}custom-a`]: 'a',
          [`${prefix.correlationPrefix}custom-b`]: 'b'
        }
      },
      requestContext: {
        requestId: 'requestId',
        functionName: 'tap tests'
      }
    },
    {
      ...defaultContext
    }
  )
  assert.deepEqual(correlationIds, {
    'x-correlation-api-id': 'requestId',
    'x-correlation-call-chain-length': 1,
    'x-correlation-custom-a': 'a',
    'x-correlation-custom-b': 'b',
    'x-correlation-debug-log-enabled': true,
    'x-correlation-git-commit': 'git commit',
    'x-correlation-id': 'awsRequestId',
    'x-correlation-lambda': 'tap tests',
    'x-correlation-log-stream': 'logGroupName/logStreamName',
    'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
    'x-correlation-user-id': undefined
  })
})

await test('replace correlationIds', async () => {
  Math.random = () => 0.05
  const correlationIds = await handler(function (
    _event,
    _context,
    { correlationIds, replaceCorrelationIds }
  ) {
    replaceCorrelationIds({
      'custom-a': 'a',
      'custom-b': 'b',
      [prefix.debugLogEnabled]: false
    })
    return correlationIds
  })(
    {
      requestContext: {
        requestId: 'requestId'
      }
    },
    {
      ...defaultContext
    }
  )
  assert.deepEqual(correlationIds, {
    'x-correlation-api-id': 'requestId',
    'x-correlation-call-chain-length': 1,
    'x-correlation-custom-a': 'a',
    'x-correlation-custom-b': 'b',
    'x-correlation-debug-log-enabled': false,
    'x-correlation-git-commit': 'git commit',
    'x-correlation-id': 'awsRequestId',
    'x-correlation-lambda': 'tap tests',
    'x-correlation-log-stream': 'logGroupName/logStreamName',
    'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
    'x-correlation-user-id': undefined
  })
})

await test('first call (user/not sampled) restapi', async () => {
  Math.random = () => 0.06
  const correlationIds = await handler(function (
    _event,
    _context,
    { correlationIds }
  ) {
    return correlationIds
  })(
    {
      requestContext: {
        requestId: 'requestId',
        authorizer: {
          id: 'user id'
        }
      }
    },
    {
      ...defaultContext
    }
  )
  assert.deepEqual(correlationIds, {
    'x-correlation-api-id': 'requestId',
    'x-correlation-call-chain-length': 1,
    'x-correlation-debug-log-enabled': false,
    'x-correlation-git-commit': 'git commit',
    'x-correlation-id': 'awsRequestId',
    'x-correlation-lambda': 'tap tests',
    'x-correlation-log-stream': 'logGroupName/logStreamName',
    'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
    'x-correlation-user-id': 'user id'
  })
})
await test('first call (user/not sampled) httpapi', async () => {
  Math.random = () => 0.06
  const correlationIds = await handler(function (
    _event,
    _context,
    { correlationIds }
  ) {
    return correlationIds
  })(
    {
      requestContext: {
        requestId: 'requestId',
        authorizer: {
          lambda: {
            id: 'user id'
          }
        }
      }
    },
    {
      ...defaultContext
    }
  )
  assert.deepEqual(correlationIds, {
    'x-correlation-api-id': 'requestId',
    'x-correlation-call-chain-length': 1,
    'x-correlation-debug-log-enabled': false,
    'x-correlation-git-commit': 'git commit',
    'x-correlation-id': 'awsRequestId',
    'x-correlation-lambda': 'tap tests',
    'x-correlation-log-stream': 'logGroupName/logStreamName',
    'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
    'x-correlation-user-id': 'user id'
  })
})
await test('call chain restapi', async () => {
  Math.random = () => 0.05
  const correlationIds = await handler(function (
    _event,
    _context,
    { correlationIds }
  ) {
    return correlationIds
  })(
    {
      requestContext: {
        requestId: 'requestId',
        authorizer: {
          id: 'user id'
        }
      }
    },
    {
      ...defaultContext
    }
  )

  await handler(function (_event, _context, { correlationIds }) {
    return correlationIds
  })(
    {
      ...correlationIds,
      requestContext: {
        requestId: 'requestId',
        authorizer: {
          id: 'user id'
        }
      }
    },
    {
      ...defaultContext
    }
  )

  assert.deepEqual(correlationIds, {
    'x-correlation-api-id': 'requestId',
    'x-correlation-call-chain-length': 1,
    'x-correlation-debug-log-enabled': true,
    'x-correlation-git-commit': 'git commit',
    'x-correlation-id': 'awsRequestId',
    'x-correlation-lambda': 'tap tests',
    'x-correlation-log-stream': 'logGroupName/logStreamName',
    'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
    'x-correlation-user-id': 'user id'
  })
})
await test('infinite loop detection', async () => {
  try {
    process.env.LOG_LEVEL = '70'
    await handler(function () {})(
      {
        [prefix.callChain]: 9,
        [prefix.debugLogEnabled]: false,
        requestContext: {
          requestId: 'requestId'
        }
      },
      {
        ...defaultContext
      }
    )
  } catch (error) {
    assert.equal(
      error.message,
      'Possible infinite recursion detected, invocation is stopped.'
    )
  }
  delete process.env.LOG_LEVEL
})

await test('parse headers', async () => {
  const headerParser = await handler(function (
    _event,
    _context,
    { headerParser }
  ) {
    return headerParser
  })(
    {
      headers: {
        HoSt: 'x.execute-api.region.amazonaws.com',
        OriGin: 'https://example.com',
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.0.0 Safari/537.36'
      }
    },
    {
      ...defaultContext
    }
  )
  const headers = headerParser()
  assert.deepEqual(headers, {
    'user-agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.0.0 Safari/537.36',
    host: 'x.execute-api.region.amazonaws.com',
    origin: 'https://example.com'
  })
})

await test('parse form plaintext', async () => {
  const bodyParser = await handler(function (_event, _context, { bodyParser }) {
    return bodyParser
  })(
    {
      body: new URLSearchParams({
        hello: 'there åäö',
        love: 'cors'
      }).toString()
    },
    {
      ...defaultContext
    }
  )
  const body = bodyParser.form()
  assert.deepEqual(
    [...body.keys()].map((key) => [key, body.get(key)]),
    [
      ['hello', 'there åäö'],
      ['love', 'cors']
    ]
  )
})

await test('parse form base64', async () => {
  const bodyParser = await handler(function (_event, _context, { bodyParser }) {
    return bodyParser
  })(
    {
      body: Buffer.from(
        new URLSearchParams({
          hello: 'there åäö',
          love: 'cors'
        }).toString()
      ).toString('base64'),
      isBase64Encoded: true
    },
    {
      ...defaultContext
    }
  )
  const body = bodyParser.form()
  assert.deepEqual(
    [...body.keys()].map((key) => [key, body.get(key)]),
    [
      ['hello', 'there åäö'],
      ['love', 'cors']
    ]
  )
})
await test('parse json plaintext', async () => {
  const bodyParser = await handler(function (_event, _context, { bodyParser }) {
    return bodyParser
  })(
    {
      body: JSON.stringify({
        hello: 'there åäö',
        love: 'cors'
      })
    },
    {
      ...defaultContext
    }
  )
  const body = bodyParser.json()
  assert.deepEqual(body, { hello: 'there åäö', love: 'cors' })
})

await test('parse json base64', async () => {
  const bodyParser = await handler(function (_event, _context, { bodyParser }) {
    return bodyParser
  })(
    {
      body: Buffer.from(
        JSON.stringify({
          hello: 'there åäö',
          love: 'cors'
        })
      ).toString('base64'),
      isBase64Encoded: true
    },
    {
      ...defaultContext
    }
  )
  const body = bodyParser.json()
  assert.deepEqual(body, { hello: 'there åäö', love: 'cors' })
})

await test('parse body plaintext', async () => {
  const bodyParser = await handler(function (_event, _context, { bodyParser }) {
    return bodyParser
  })(
    {
      body: 'hi there åäö, love cors'
    },
    {
      ...defaultContext
    }
  )
  const body = bodyParser.text()
  assert.deepEqual(body, 'hi there åäö, love cors')
})

await test('parse body base64', async () => {
  const bodyParser = await handler(function (_event, _context, { bodyParser }) {
    return bodyParser
  })(
    {
      body: Buffer.from('hi there åäö, love cors').toString('base64'),
      isBase64Encoded: true
    },
    {
      functionName: 'tap tests',
      getRemainingTimeInMillis: () => 51
    }
  )
  const body = bodyParser.text()
  assert.deepEqual(body, 'hi there åäö, love cors')
})

await test('abort signal not aborted', async () => {
  const abortSignal = await handler(function (
    _event,
    _context,
    { abortSignal }
  ) {
    return abortSignal
  })(
    {},
    {
      ...defaultContext
    }
  )
  assert.equal(abortSignal.aborted, false)
})

await test('abort signal aborted', async () => {
  await assert.rejects(
    handler(async function (_event, _context, { abortSignal }) {
      await setTimeout(3, 'result', { signal: abortSignal })
    })(
      {},
      {
        ...defaultContext
      }
    ),
    'AbortError'
  )
})

await test('logging', async () => {
  const evalCode = `
     Math.random = () => 0.05
     Date.now = () => 42
     async function run() {
       const { default: handler } = await import('../lambda-handler.js')
       await handler( function (event, context, { log }) {
         for (const level of ['debug', 'info', 'warn']) {
           log[level](\`simple \${level}\`)
           log[level]({ object: true }, level)
         }
         log.error(new Error('standard error'))
         log.error({ extra: 'context' }, new Error('standard error'))

         class ApplicationError extends Error {}

         log.error(new ApplicationError('application error'))
         log.error({ extra: 'context' }, new ApplicationError('application error'))
         log.error('just a string')
         log.error({ object: true }, 'string with object')
       })(
       {
         requestContext: {
           requestId: 'requestId'
         }
       },
       {
         awsRequestId: 'awsRequestId',
         functionName: 'tap tests',
         logGroupName: 'logGroupName',
         logStreamName: 'logStreamName',
         getRemainingTimeInMillis: () => 51
       })
     }
     run()
     `

  const tempFile = path.posix.join(__dirname, crypto.randomUUID()) + '.mjs'
  await writeFile(tempFile, evalCode)

  const stdout = []
  const stderr = []

  const ps = spawn(process.argv[0], [tempFile], {
    shell: true
  })

  ps.stdout.on('data', (chunk) => stdout.push(chunk))
  ps.stderr.on('data', (chunk) => stderr.push(chunk))

  await once(ps, 'close')

  await unlink(tempFile)

  assert.equal(ps.exitCode, 0)

  const stdoutMessages = ldjson(stdout)
  const stderrMessages = ldjson(stderr)
  assert.deepEqual(
    stdoutMessages,

    [
      {
        msg: 'simple debug',
        awsRequestId: 'awsRequestId',
        apiRequestId: 'requestId',
        'x-correlation-id': 'awsRequestId',
        'x-correlation-api-id': 'requestId',
        'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
        'x-correlation-call-chain-length': 1,
        'x-correlation-debug-log-enabled': true,
        'x-correlation-lambda': 'tap tests',
        'x-correlation-git-commit': 'git commit',
        'x-correlation-log-stream': 'logGroupName/logStreamName',
        level: 'debug',
        time: 0
      },
      {
        msg: 'debug',
        awsRequestId: 'awsRequestId',
        apiRequestId: 'requestId',
        'x-correlation-id': 'awsRequestId',
        'x-correlation-api-id': 'requestId',
        'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
        'x-correlation-call-chain-length': 1,
        'x-correlation-debug-log-enabled': true,
        'x-correlation-lambda': 'tap tests',
        'x-correlation-git-commit': 'git commit',
        'x-correlation-log-stream': 'logGroupName/logStreamName',
        level: 'debug',
        time: 0,
        object: true
      },
      {
        msg: 'simple info',
        awsRequestId: 'awsRequestId',
        apiRequestId: 'requestId',
        'x-correlation-id': 'awsRequestId',
        'x-correlation-api-id': 'requestId',
        'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
        'x-correlation-call-chain-length': 1,
        'x-correlation-debug-log-enabled': true,
        'x-correlation-lambda': 'tap tests',
        'x-correlation-git-commit': 'git commit',
        'x-correlation-log-stream': 'logGroupName/logStreamName',
        level: 'info',
        time: 0
      },
      {
        msg: 'info',
        awsRequestId: 'awsRequestId',
        apiRequestId: 'requestId',
        'x-correlation-id': 'awsRequestId',
        'x-correlation-api-id': 'requestId',
        'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
        'x-correlation-call-chain-length': 1,
        'x-correlation-debug-log-enabled': true,
        'x-correlation-lambda': 'tap tests',
        'x-correlation-git-commit': 'git commit',
        'x-correlation-log-stream': 'logGroupName/logStreamName',
        level: 'info',
        time: 0,
        object: true
      },
      {
        msg: 'simple warn',
        awsRequestId: 'awsRequestId',
        apiRequestId: 'requestId',
        'x-correlation-id': 'awsRequestId',
        'x-correlation-api-id': 'requestId',
        'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
        'x-correlation-call-chain-length': 1,
        'x-correlation-debug-log-enabled': true,
        'x-correlation-lambda': 'tap tests',
        'x-correlation-git-commit': 'git commit',
        'x-correlation-log-stream': 'logGroupName/logStreamName',
        level: 'warn',
        time: 0
      },
      {
        msg: 'warn',
        awsRequestId: 'awsRequestId',
        apiRequestId: 'requestId',
        'x-correlation-id': 'awsRequestId',
        'x-correlation-api-id': 'requestId',
        'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
        'x-correlation-call-chain-length': 1,
        'x-correlation-debug-log-enabled': true,
        'x-correlation-lambda': 'tap tests',
        'x-correlation-git-commit': 'git commit',
        'x-correlation-log-stream': 'logGroupName/logStreamName',
        level: 'warn',
        time: 0,
        object: true
      }
    ]
  )
  assert.deepEqual(stderrMessages, [
    {
      msg: 'standard error',
      awsRequestId: 'awsRequestId',
      apiRequestId: 'requestId',
      'x-correlation-id': 'awsRequestId',
      'x-correlation-api-id': 'requestId',
      'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
      'x-correlation-call-chain-length': 1,
      'x-correlation-debug-log-enabled': true,
      'x-correlation-lambda': 'tap tests',
      'x-correlation-git-commit': 'git commit',
      'x-correlation-log-stream': 'logGroupName/logStreamName',
      level: 'error',
      time: 0,
      type: 'Error',
      stack: 'striped-stack'
    },
    {
      msg: 'standard error',
      awsRequestId: 'awsRequestId',
      apiRequestId: 'requestId',
      'x-correlation-id': 'awsRequestId',
      'x-correlation-api-id': 'requestId',
      'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
      'x-correlation-call-chain-length': 1,
      'x-correlation-debug-log-enabled': true,
      'x-correlation-lambda': 'tap tests',
      'x-correlation-git-commit': 'git commit',
      'x-correlation-log-stream': 'logGroupName/logStreamName',
      level: 'error',
      time: 0,
      extra: 'context',
      type: 'Error',
      stack: 'striped-stack'
    },
    {
      msg: 'application error',
      awsRequestId: 'awsRequestId',
      apiRequestId: 'requestId',
      'x-correlation-id': 'awsRequestId',
      'x-correlation-api-id': 'requestId',
      'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
      'x-correlation-call-chain-length': 1,
      'x-correlation-debug-log-enabled': true,
      'x-correlation-lambda': 'tap tests',
      'x-correlation-git-commit': 'git commit',
      'x-correlation-log-stream': 'logGroupName/logStreamName',
      level: 'error',
      time: 0,
      type: 'ApplicationError',
      stack: 'striped-stack'
    },
    {
      msg: 'application error',
      awsRequestId: 'awsRequestId',
      apiRequestId: 'requestId',
      'x-correlation-id': 'awsRequestId',
      'x-correlation-api-id': 'requestId',
      'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
      'x-correlation-call-chain-length': 1,
      'x-correlation-debug-log-enabled': true,
      'x-correlation-lambda': 'tap tests',
      'x-correlation-git-commit': 'git commit',
      'x-correlation-log-stream': 'logGroupName/logStreamName',
      level: 'error',
      time: 0,
      extra: 'context',
      type: 'ApplicationError',
      stack: 'striped-stack'
    },
    {
      msg: 'just a string',
      awsRequestId: 'awsRequestId',
      apiRequestId: 'requestId',
      'x-correlation-id': 'awsRequestId',
      'x-correlation-api-id': 'requestId',
      'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
      'x-correlation-call-chain-length': 1,
      'x-correlation-debug-log-enabled': true,
      'x-correlation-lambda': 'tap tests',
      'x-correlation-git-commit': 'git commit',
      'x-correlation-log-stream': 'logGroupName/logStreamName',
      level: 'error',
      time: 0
    },
    {
      msg: 'string with object',
      awsRequestId: 'awsRequestId',
      apiRequestId: 'requestId',
      'x-correlation-id': 'awsRequestId',
      'x-correlation-api-id': 'requestId',
      'x-correlation-trace-id': 'Root=<tap test>;Parent=x;Sampled=1',
      'x-correlation-call-chain-length': 1,
      'x-correlation-debug-log-enabled': true,
      'x-correlation-lambda': 'tap tests',
      'x-correlation-git-commit': 'git commit',
      'x-correlation-log-stream': 'logGroupName/logStreamName',
      level: 'error',
      time: 0,
      object: true
    }
  ])
})

function spawn(cmd, arguments_, options) {
  const windows = os.platform() === 'win32'
  if (windows) {
    arguments_ = [
      '/C',
      cmd,
      ...arguments_.map((argument) => {
        return String(argument).replaceAll('^', '^^^^')
      })
    ]
    cmd = 'cmd'
  }
  return nativeSpawn(cmd, arguments_, options)
}

function ldjson(output) {
  return lines(output).map((line) => JSON.parse(line))
}

function lines(output) {
  return strip(Buffer.concat(output).toString()).split(/\n/).filter(Boolean)
}

function strip(s) {
  return s
    .replaceAll(/"pid":\s*\d+/g, '"pid": 1')
    .replaceAll(/"time":\s*\d+/g, '"time": 0')
    .replaceAll(/"stack":\s*"[^"]+"/g, '"stack": "striped-stack"')
    .replaceAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, 'stripped-time')
}
