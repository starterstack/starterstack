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
          input.ExpressionAttributeValues?.[':cid'] === undefined
        switch (context.commandName) {
          case 'UpdateItemCommand': {
            input.ExpressionAttributeNames =
              input.ExpressionAttributeNames || {}
            input.ExpressionAttributeValues =
              input.ExpressionAttributeValues || {}

            if (userId) {
              if (/set /i.test(input.UpdateExpression)) {
                input.UpdateExpression = addCid
                  ? input.UpdateExpression.replace(
                      /set /i,
                      'set #modifiedBy = :modifiedBy, #modifiedAt = :modifiedAt, #cid = :cid, '
                    )
                  : input.UpdateExpression.replace(
                      /set /i,
                      'set #modifiedBy = :modifiedBy, #modifiedAt = :modifiedAt, '
                    )
              } else {
                input.UpdateExpression += addCid
                  ? ' set #modifiedBy = :modifiedBy, #modifiedAt = :modifiedAt, #cid = :cid'
                  : ' set #modifiedBy = :modifiedBy, #modifiedAt = :modifiedAt'
              }
              input.ExpressionAttributeValues[':modifiedBy'] = userId
              input.ExpressionAttributeNames['#modifiedBy'] = 'modifiedBy'
            } else {
              if (/set /i.test(input.UpdateExpression)) {
                input.UpdateExpression = addCid
                  ? input.UpdateExpression.replace(
                      /set /i,
                      'set #modifiedAt = :modifiedAt, #cid = :cid, '
                    )
                  : input.UpdateExpression.replace(
                      /set /i,
                      'set #modifiedAt = :modifiedAt, '
                    )
              } else {
                input.UpdateExpression += addCid
                  ? ' set #modifiedAt = :modifiedAt, #cid = :cid'
                  : ' set #modifiedAt = :modifiedAt'
              }
            }
            input.ExpressionAttributeValues[':modifiedAt'] = Date.now()
            input.ExpressionAttributeNames['#modifiedAt'] = 'modifiedAt'
            if (addCid) {
              input.ExpressionAttributeValues[':cid'] = correlationIds
              input.ExpressionAttributeNames['#cid'] = 'correlationIds'
            }

            break
          }
          case 'PutItemCommand': {
            if (userId) input.Item.createdBy = userId
            input.Item.createdAt = Date.now()
            if (input.Item.correlationIds === undefined) {
              input.Item.correlationIds = correlationIds
            }

            break
          }
          case 'BatchWriteItemCommand': {
            for (const table of Object.keys(input.RequestItems)) {
              for (const item of input.RequestItems[table]) {
                if (item.PutRequest) {
                  if (userId) {
                    item.PutRequest.Item.createdBy = userId
                  }
                  item.PutRequest.Item.createdAt = Date.now()
                  if (item.PutRequest.Item.correlationIds === undefined) {
                    item.PutRequest.Item.correlationIds = correlationIds
                  }
                }
              }
            }

            break
          }
          // No default
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
