import test from 'node:test'
import assert from 'node:assert/strict'
import { PutEventsCommand } from '@aws-sdk/client-eventbridge'
import eventBridge, { assertFailedEntries } from '../eventbridge.js'

await test('eventbridge middleware', async (t) => {
  t.beforeEach(() => {
    delete globalThis[Symbol.for('correlationIds')]
  })
  await t.test('anonymous event with no detail', async () => {
    const command = new PutEventsCommand({
      Entries: [
        {
          EventBusName: 'bus',
          Source: 'source',
          DetailType: 'detailType'
        }
      ]
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = eventBridge.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, eventBridge.config)

    await handler(command)

    assert.deepEqual(JSON.parse(result.input.Entries[0].Detail), {
      correlationIds: {}
    })
  })
  await t.test('user event with no detail', async () => {
    globalThis[Symbol.for('correlationIds')] = {
      'x-correlation-id': 42,
      'x-correlation-user-id': 'user-id'
    }
    const command = new PutEventsCommand({
      Entries: [
        {
          EventBusName: 'bus',
          Source: 'source',
          DetailType: 'detailType'
        }
      ]
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = eventBridge.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, eventBridge.config)

    await handler(command)

    assert.deepEqual(JSON.parse(result.input.Entries[0].Detail), {
      correlationIds: {
        'x-correlation-id': 42,
        'x-correlation-user-id': 'user-id'
      }
    })
  })
  await t.test('anonymous event with detail', async () => {
    const command = new PutEventsCommand({
      Entries: [
        {
          EventBusName: 'bus',
          Source: 'source',
          DetailType: 'detailType',
          Detail: JSON.stringify({
            email: true
          })
        }
      ]
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = eventBridge.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, eventBridge.config)

    await handler(command)

    assert.deepEqual(JSON.parse(result.input.Entries[0].Detail), {
      email: true,
      correlationIds: {}
    })
  })
  await t.test('user event with detail', async () => {
    globalThis[Symbol.for('correlationIds')] = {
      'x-correlation-id': 42,
      'x-correlation-user-id': 'user-id'
    }
    const command = new PutEventsCommand({
      Entries: [
        {
          EventBusName: 'bus',
          Source: 'source',
          DetailType: 'detailType',
          Detail: JSON.stringify({
            email: true
          })
        }
      ]
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = eventBridge.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, eventBridge.config)

    await handler(command)

    assert.deepEqual(JSON.parse(result.input.Entries[0].Detail), {
      correlationIds: {
        'x-correlation-id': 42,
        'x-correlation-user-id': 'user-id'
      },
      email: true
    })
  })
  await t.test('detail with existing correlation ids', async () => {
    globalThis[Symbol.for('correlationIds')] = {
      'x-correlation-id': 42,
      'x-correlation-user-id': 'user-id'
    }
    const command = new PutEventsCommand({
      Entries: [
        {
          EventBusName: 'bus',
          Source: 'source',
          DetailType: 'detailType',
          Detail: JSON.stringify({
            correlationIds: false
          })
        }
      ]
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = eventBridge.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, eventBridge.config)

    await handler(command)

    assert.deepEqual(JSON.parse(result.input.Entries[0].Detail), {
      correlationIds: false
    })
  })
})

await test('eventbridge assert failed entries', () => {
  assertFailedEntries({
    FailedEntryCount: 0,
    Entries: []
  })

  try {
    assertFailedEntries({
      FailedEntryCount: 1,
      Entries: []
    })
    throw new Error('assertFailedEntries did not throw')
  } catch (error) {
    assert.equal(error.message, 'assertFailedEntries failed []')
  }
})
