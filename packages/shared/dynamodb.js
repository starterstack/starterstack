// @ts-check
import process from 'node:process'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import AWSXRay from 'aws-xray-sdk-core'

/** @type DynamoDBClient */
// @ts-ignore
export const client = new DynamoDBClient({
  logger: null,
  ...(process.env.IS_OFFLINE && {
    endpoint: 'http://localhost:8000',
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'x',
      secretAccessKey: 'x'
    }
  })
})

/** @type DynamoDBDocumentClient */
export default trace(createDocumentClient())

function createDocumentClient() {
  client.middlewareStack.add(
    (next, context) => (args) => {
      if (
        context.commandName === 'UpdateItemCommand' ||
        context.commandName === 'PutItemCommand' ||
        context.commandName === 'BatchWriteItemCommand'
      ) {
        // @ts-ignore
        const correlationIds = globalThis[Symbol.for('correlationIds')] ?? {}
        const userId = correlationIds['x-correlation-user-id']
        /** @type any */
        const input = args.input
        const addCid =
          !input.ExpressionAttributeNames?.['#cid'] &&
          typeof input.ExpressionAttributeValues?.[':cid'] === 'undefined'
        if (context.commandName === 'UpdateItemCommand') {
          input.ExpressionAttributeNames = input.ExpressionAttributeNames || {}
          input.ExpressionAttributeValues =
            input.ExpressionAttributeValues || {}

          if (userId) {
            if (input.UpdateExpression.match(/set /i)) {
              if (addCid) {
                input.UpdateExpression = input.UpdateExpression.replace(
                  /set /i,
                  'set #modifiedBy = :modifiedBy, #modifiedAt = :modifiedAt, #cid = :cid, '
                )
              } else {
                input.UpdateExpression = input.UpdateExpression.replace(
                  /set /i,
                  'set #modifiedBy = :modifiedBy, #modifiedAt = :modifiedAt, '
                )
              }
            } else {
              if (addCid) {
                input.UpdateExpression +=
                  ' set #modifiedBy = :modifiedBy, #modifiedAt = :modifiedAt, #cid = :cid'
              } else {
                input.UpdateExpression +=
                  ' set #modifiedBy = :modifiedBy, #modifiedAt = :modifiedAt'
              }
            }
            input.ExpressionAttributeValues[':modifiedBy'] = userId
            input.ExpressionAttributeNames['#modifiedBy'] = 'modifiedBy'
          } else {
            if (input.UpdateExpression.match(/set /i)) {
              if (addCid) {
                input.UpdateExpression = input.UpdateExpression.replace(
                  /set /i,
                  'set #modifiedAt = :modifiedAt, #cid = :cid, '
                )
              } else {
                input.UpdateExpression = input.UpdateExpression.replace(
                  /set /i,
                  'set #modifiedAt = :modifiedAt, '
                )
              }
            } else {
              if (addCid) {
                input.UpdateExpression +=
                  ' set #modifiedAt = :modifiedAt, #cid = :cid'
              } else {
                input.UpdateExpression += ' set #modifiedAt = :modifiedAt'
              }
            }
          }
          input.ExpressionAttributeValues[':modifiedAt'] = Date.now()
          input.ExpressionAttributeNames['#modifiedAt'] = 'modifiedAt'
          if (addCid) {
            input.ExpressionAttributeValues[':cid'] = correlationIds
            input.ExpressionAttributeNames['#cid'] = 'correlationIds'
          }
        } else if (context.commandName === 'PutItemCommand') {
          if (userId) input.Item.createdBy = userId
          input.Item.createdAt = Date.now()
          if (typeof input.Item.correlationIds === 'undefined') {
            input.Item.correlationIds = correlationIds
          }
        } else if (context.commandName === 'BatchWriteItemCommand') {
          for (const table of Object.keys(input.RequestItems)) {
            for (const item of input.RequestItems[table]) {
              if (item.PutRequest) {
                if (userId) {
                  item.PutRequest.Item.createdBy = userId
                }
                item.PutRequest.Item.createdAt = Date.now()
                if (
                  typeof item.PutRequest.Item.correlationIds === 'undefined'
                ) {
                  item.PutRequest.Item.correlationIds = correlationIds
                }
              }
            }
          }
        }
      }
      return next(args)
    },
    {
      step: 'initialize',
      name: 'addTraceData',
      tags: ['metadata', 'traceData']
    }
  )

  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      convertEmptyValues: false,
      removeUndefinedValues: true,
      convertClassInstanceToMap: false
    },
    unmarshallOptions: {
      wrapNumbers: false
    }
  })
}

function trace(/** @type any */ client) {
  return process.env.LAMBDA_TASK_ROOT && process.env.AWS_EXECUTION_ENV
    ? AWSXRay.captureAWSv3Client(client)
    : client
}
