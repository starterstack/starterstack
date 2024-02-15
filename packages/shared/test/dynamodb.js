import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PutCommand,
  UpdateCommand,
  BatchWriteCommand
} from '@aws-sdk/lib-dynamodb'
import dynamodb from '../dynamodb.js'

await test('dynamodb middleware', async (t) => {
  t.beforeEach(() => {
    delete globalThis[Symbol.for('correlationIds')]
  })
  await t.test('anonymous put', async () => {
    const command = new PutCommand({
      Table: 'table',
      Item: {
        pk: 'pk',
        sk: 'sk'
      }
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = dynamodb.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, dynamodb.config)

    await handler(command)

    assert.equal(typeof result.input.Item.createdAt, 'number')
    result.input.Item.createdAt = 42

    assert.deepEqual(result.input, {
      Item: {
        correlationIds: {},
        createdAt: 42,
        pk: 'pk',
        sk: 'sk'
      },
      Table: 'table'
    })
  })

  await t.test('put with user and correlation ids', async () => {
    globalThis[Symbol.for('correlationIds')] = {
      'x-correlation-id': 'unique-id',
      'x-correlation-user-id': 'user-id'
    }
    const command = new PutCommand({
      Table: 'table',
      Item: {
        pk: 'pk',
        sk: 'sk'
      }
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = dynamodb.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, dynamodb.config)

    await handler(command)

    assert.equal(typeof result.input.Item.createdAt, 'number')
    result.input.Item.createdAt = 42

    assert.deepEqual(result.input, {
      Item: {
        correlationIds: {
          'x-correlation-id': 'unique-id',
          'x-correlation-user-id': 'user-id'
        },
        createdAt: 42,
        createdBy: 'user-id',
        pk: 'pk',
        sk: 'sk'
      },
      Table: 'table'
    })
  })
  await t.test('put correlation ids not overwritten', async () => {
    globalThis[Symbol.for('correlationIds')] = {
      'x-correlation-id': 'unique-id',
      'x-correlation-user-id': 'user-id'
    }
    const command = new PutCommand({
      Table: 'table',
      Item: {
        pk: 'pk',
        sk: 'sk',
        correlationIds: false
      }
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = dynamodb.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, dynamodb.config)

    await handler(command)

    assert.equal(typeof result.input.Item.createdAt, 'number')
    result.input.Item.createdAt = 42

    assert.deepEqual(result.input, {
      Item: {
        correlationIds: false,
        createdAt: 42,
        createdBy: 'user-id',
        pk: 'pk',
        sk: 'sk'
      },
      Table: 'table'
    })
  })
  await t.test('update with existing set', async () => {
    const command = new UpdateCommand({
      Table: 'table',
      Key: {
        pk: 'pk',
        sk: 'sk'
      },
      UpdateExpression: 'set #name = if_not_exists(#name, :name)',
      ExpressionAttributeNames: {
        '#name': 'name'
      },
      ExpressionAttributeValues: {
        ':name': 'name'
      }
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = dynamodb.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, dynamodb.config)

    await handler(command)

    assert.equal(
      typeof result.input.ExpressionAttributeValues[':modifiedAt'],
      'number'
    )
    result.input.ExpressionAttributeValues[':modifiedAt'] = 42

    assert.deepEqual(result.input, {
      Table: 'table',
      Key: {
        pk: 'pk',
        sk: 'sk'
      },
      UpdateExpression:
        'set #modifiedAt = :modifiedAt, #cid = :cid, #name = if_not_exists(#name, :name)',
      ExpressionAttributeNames: {
        '#cid': 'correlationIds',
        '#modifiedAt': 'modifiedAt',
        '#name': 'name'
      },
      ExpressionAttributeValues: {
        ':cid': {},
        ':modifiedAt': 42,
        ':name': 'name'
      }
    })
  })
  await t.test('update with not existing set', async () => {
    const command = new UpdateCommand({
      Table: 'table',
      Key: {
        pk: 'pk',
        sk: 'sk'
      },
      UpdateExpression: 'add #count :inc',
      ExpressionAttributeNames: {
        '#count': 'count'
      },
      ExpressionAttributeValues: {
        ':inc': 1
      }
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = dynamodb.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, dynamodb.config)

    await handler(command)

    assert.equal(
      typeof result.input.ExpressionAttributeValues[':modifiedAt'],
      'number'
    )
    result.input.ExpressionAttributeValues[':modifiedAt'] = 42

    assert.deepEqual(result.input, {
      Table: 'table',
      Key: {
        pk: 'pk',
        sk: 'sk'
      },
      UpdateExpression:
        'add #count :inc set #modifiedAt = :modifiedAt, #cid = :cid',
      ExpressionAttributeNames: {
        '#cid': 'correlationIds',
        '#modifiedAt': 'modifiedAt',
        '#count': 'count'
      },
      ExpressionAttributeValues: {
        ':cid': {},
        ':modifiedAt': 42,
        ':inc': 1
      }
    })
  })
  await t.test('update with existing #cid', async () => {
    const command = new UpdateCommand({
      Table: 'table',
      Key: {
        pk: 'pk',
        sk: 'sk'
      },
      UpdateExpression: 'set #cid = :cid',
      ExpressionAttributeNames: {
        '#cid': 'correlationIds'
      },
      ExpressionAttributeValues: {
        ':cid': false
      }
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = dynamodb.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, dynamodb.config)

    await handler(command)

    assert.equal(
      typeof result.input.ExpressionAttributeValues[':modifiedAt'],
      'number'
    )
    result.input.ExpressionAttributeValues[':modifiedAt'] = 42

    assert.deepEqual(result.input, {
      Table: 'table',
      Key: {
        pk: 'pk',
        sk: 'sk'
      },
      UpdateExpression: 'set #modifiedAt = :modifiedAt, #cid = :cid',
      ExpressionAttributeNames: {
        '#cid': 'correlationIds',
        '#modifiedAt': 'modifiedAt'
      },
      ExpressionAttributeValues: {
        ':cid': false,
        ':modifiedAt': 42
      }
    })
  })
  await t.test('update with existing :cid', async () => {
    const command = new UpdateCommand({
      Table: 'table',
      Key: {
        pk: 'pk',
        sk: 'sk'
      },
      UpdateExpression: 'set #id = :cid',
      ExpressionAttributeNames: {
        '#id': 'id'
      },
      ExpressionAttributeValues: {
        ':cid': 42
      }
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = dynamodb.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, dynamodb.config)

    await handler(command)

    assert.equal(
      typeof result.input.ExpressionAttributeValues[':modifiedAt'],
      'number'
    )
    result.input.ExpressionAttributeValues[':modifiedAt'] = 42

    assert.deepEqual(result.input, {
      Table: 'table',
      Key: {
        pk: 'pk',
        sk: 'sk'
      },
      UpdateExpression: 'set #modifiedAt = :modifiedAt, #id = :cid',
      ExpressionAttributeNames: {
        '#id': 'id',
        '#modifiedAt': 'modifiedAt'
      },
      ExpressionAttributeValues: {
        ':cid': 42,
        ':modifiedAt': 42
      }
    })
  })
  await t.test('anonymous batch write', async () => {
    const command = new BatchWriteCommand({
      RequestItems: {
        table: [
          {
            PutRequest: {
              Item: {
                pk: 'pk',
                sk: 'sk'
              }
            }
          }
        ]
      }
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = dynamodb.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, dynamodb.config)

    await handler(command)

    assert.equal(
      typeof result.input.RequestItems.table[0].PutRequest.Item.createdAt,
      'number'
    )
    result.input.RequestItems.table[0].PutRequest.Item.createdAt = 42

    assert.deepEqual(result.input, {
      RequestItems: {
        table: [
          {
            PutRequest: {
              Item: {
                pk: 'pk',
                sk: 'sk',
                correlationIds: {},
                createdAt: 42
              }
            }
          }
        ]
      }
    })
  })
  await t.test('batch write with user', async () => {
    globalThis[Symbol.for('correlationIds')] = {
      'x-correlation-id': 'unique-id',
      'x-correlation-user-id': 'user-id'
    }
    const command = new BatchWriteCommand({
      RequestItems: {
        table: [
          {
            PutRequest: {
              Item: {
                pk: 'pk',
                sk: 'sk'
              }
            }
          }
        ]
      }
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = dynamodb.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, dynamodb.config)

    await handler(command)

    assert.equal(
      typeof result.input.RequestItems.table[0].PutRequest.Item.createdAt,
      'number'
    )
    result.input.RequestItems.table[0].PutRequest.Item.createdAt = 42

    assert.deepEqual(result.input, {
      RequestItems: {
        table: [
          {
            PutRequest: {
              Item: {
                pk: 'pk',
                sk: 'sk',
                correlationIds: {
                  'x-correlation-id': 'unique-id',
                  'x-correlation-user-id': 'user-id'
                },
                createdAt: 42,
                createdBy: 'user-id'
              }
            }
          }
        ]
      }
    })
  })
  await t.test('batch write with existing correlationIds', async () => {
    globalThis[Symbol.for('correlationIds')] = {
      'x-correlation-id': 'unique-id',
      'x-correlation-user-id': 'user-id'
    }
    const command = new BatchWriteCommand({
      RequestItems: {
        table: [
          {
            PutRequest: {
              Item: {
                pk: 'pk',
                sk: 'sk',
                correlationIds: false
              }
            }
          }
        ]
      }
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = dynamodb.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, dynamodb.config)

    await handler(command)

    assert.equal(
      typeof result.input.RequestItems.table[0].PutRequest.Item.createdAt,
      'number'
    )
    result.input.RequestItems.table[0].PutRequest.Item.createdAt = 42

    assert.deepEqual(result.input, {
      RequestItems: {
        table: [
          {
            PutRequest: {
              Item: {
                pk: 'pk',
                sk: 'sk',
                correlationIds: false,
                createdAt: 42,
                createdBy: 'user-id'
              }
            }
          }
        ]
      }
    })
  })
  await t.test('update with no attributes', async () => {
    const command = new UpdateCommand({
      Table: 'table',
      Key: {
        pk: 'pk',
        sk: 'sk'
      },
      UpdateExpression: 'remove property'
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = dynamodb.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, dynamodb.config)

    await handler(command)

    assert.equal(
      typeof result.input.ExpressionAttributeValues[':modifiedAt'],
      'number'
    )
    result.input.ExpressionAttributeValues[':modifiedAt'] = 42

    assert.deepEqual(result.input, {
      Table: 'table',
      Key: {
        pk: 'pk',
        sk: 'sk'
      },
      UpdateExpression:
        'remove property set #modifiedAt = :modifiedAt, #cid = :cid',
      ExpressionAttributeNames: {
        '#cid': 'correlationIds',
        '#modifiedAt': 'modifiedAt'
      },
      ExpressionAttributeValues: {
        ':cid': {},
        ':modifiedAt': 42
      }
    })
  })
})
