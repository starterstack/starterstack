import test from 'node:test'
import assert from 'node:assert/strict'
import { InvokeCommand } from '@aws-sdk/client-lambda'
import createLambda from '../lambda.js'

const lambda = createLambda()

await test('lambda middleware', async (t) => {
  t.beforeEach(() => {
    delete globalThis[Symbol.for('correlationIds')]
  })
  await t.test('anonymous empty payload', async () => {
    const command = new InvokeCommand({
      FunctionName: 'func',
      InvocationType: 'Event',
      LogType: 'None',
      Qualifier: '$LATEST'
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = lambda.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, lambda.config)

    await handler(command)

    assert.deepEqual(JSON.parse(result.input.Payload), {
      correlationIds: {}
    })
  })
  await t.test('user empty payload', async () => {
    globalThis[Symbol.for('correlationIds')] = {
      'x-correlation-user-id': 'user-id',
      'x-correlation-id': 42
    }
    const command = new InvokeCommand({
      FunctionName: 'func',
      InvocationType: 'Event',
      LogType: 'None',
      Qualifier: '$LATEST'
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = lambda.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, lambda.config)

    await handler(command)

    assert.deepEqual(JSON.parse(result.input.Payload), {
      correlationIds: {
        'x-correlation-user-id': 'user-id',
        'x-correlation-id': 42
      }
    })
  })
  await t.test('anonymous with payload', async () => {
    const command = new InvokeCommand({
      FunctionName: 'func',
      InvocationType: 'Event',
      LogType: 'None',
      Qualifier: '$LATEST',
      Payload: JSON.stringify({
        hello: 'there'
      })
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = lambda.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, lambda.config)

    await handler(command)

    assert.deepEqual(JSON.parse(result.input.Payload), {
      hello: 'there',
      correlationIds: {}
    })
  })
  await t.test('user with payload', async () => {
    globalThis[Symbol.for('correlationIds')] = {
      'x-correlation-user-id': 'user-id',
      'x-correlation-id': 42
    }
    const command = new InvokeCommand({
      FunctionName: 'func',
      InvocationType: 'Event',
      LogType: 'None',
      Qualifier: '$LATEST',
      Payload: JSON.stringify({
        force: true
      })
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = lambda.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, lambda.config)

    await handler(command)

    assert.deepEqual(JSON.parse(result.input.Payload), {
      force: true,
      correlationIds: {
        'x-correlation-user-id': 'user-id',
        'x-correlation-id': 42
      }
    })
  })
})
