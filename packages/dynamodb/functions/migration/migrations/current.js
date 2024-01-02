import dynamodb from '../dynamodb.js'
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { DYNAMODB_STACK_TABLE } from './table.js'

export default function create({ abortSignal }) {
  return {
    get() {
      return _get({ abortSignal })
    },
    update(migration) {
      return _update({ abortSignal, migration })
    }
  }
}

async function _get({ abortSignal }) {
  const { Item: { number } = {} } = await dynamodb.send(
    new GetCommand({
      TableName: DYNAMODB_STACK_TABLE,
      Key: {
        pk: 'migration',
        sk: 'migration'
      },
      ExpressionAttributeNames: {
        '#number': 'number'
      },
      ProjectionExpression: '#number'
    }),
    {
      abortSignal
    }
  )

  return { number }
}

async function _update({ abortSignal, migration }) {
  await Promise.all([
    dynamodb.send(
      new PutCommand({
        TableName: DYNAMODB_STACK_TABLE,
        Item: {
          pk: 'migration',
          sk: 'migration',
          type: 'migration',
          date: Date.now(),
          ...migration
        },
        ReturnValues: 'NONE'
      }),
      {
        abortSignal
      }
    ),
    dynamodb.send(
      new PutCommand({
        TableName: DYNAMODB_STACK_TABLE,
        Item: {
          pk: 'migration',
          sk: `migration#run#${Date.now().toString(32).padStart(15, '0')}`,
          type: 'migrationRun',
          date: Date.now(),
          ...migration
        },
        ReturnValues: 'NONE'
      }),
      {
        abortSignal
      }
    )
  ])
}
