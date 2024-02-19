import process from 'node:process'
import { createApiGatewayManagementApi } from './apigateway.js'

import {
  PutCommand,
  BatchWriteCommand,
  DeleteCommand,
  QueryCommand
} from '@aws-sdk/lib-dynamodb'

import dynamodb from './dynamodb.js'
import lambdaHandler from './lambda-handler.js'
import ms from 'ms'

export const connections = lambdaHandler(async function connections(
  event,
  _context,
  { log, abortSignal }
) {
  log.debug({ event }, 'received')
  try {
    const {
      routeKey,
      connectionId,
      domainName,
      stage,
      authorizer: { id, webSocketProtocol } = {}
    } = event.requestContext

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { postToConnection, deleteConnection } =
      createApiGatewayManagementApi({
        connectionId,
        domainName,
        stage,
        abortSignal
      })

    const isGraphqlWS = webSocketProtocol === 'graphql-transport-ws'

    if (routeKey === 'connection_init' && isGraphqlWS) {
      try {
        await dynamodb.send(
          new PutCommand({
            TableName: process.env.DYNAMODB_TABLE,
            Item: {
              pk: `graphql-ws-connection#connection#${connectionId}`,
              sk: `graphql-ws-connection#${connectionId}`,
              type: 'graphql-ws-connection',
              userId: id,
              ttl: Math.floor((Date.now() + ms('2 hours')) / 1000),
              connectionId
            },
            ConditionExpression: 'attribute_not_exists(pk)',
            ReturnValues: 'NONE'
          }),
          {
            abortSignal
          }
        )
        await postToConnection({ type: 'connection_ack' })
      } catch {
        await deleteConnection()
      }
    } else
      switch (routeKey) {
        case 'ping': {
          await postToConnection({ type: 'pong' })

          break
        }
        case '$connect': {
          if (webSocketProtocol && !isGraphqlWS) {
            return {
              statusCode: 400
            }
          }

          return {
            statusCode: 200,
            ...(webSocketProtocol && {
              headers: { 'sec-websocket-protocol': webSocketProtocol }
            })
          }
        }
        case '$disconnect': {
          for await (const batch of connectionSubscriptions({
            dynamodb,
            connectionId,
            limit: 25,
            abortSignal
          })) {
            await dynamodb.send(
              new BatchWriteCommand({
                RequestItems: {
                  [process.env.DYNAMODB_TABLE]: batch.map(({ pk, sk }) => ({
                    DeleteRequest: {
                      Key: {
                        pk,
                        sk
                      }
                    }
                  }))
                }
              }),
              {
                abortSignal
              }
            )
          }
          await dynamodb.send(
            new DeleteCommand({
              TableName: process.env.DYNAMODB_TABLE,
              Key: {
                pk: `graphql-ws-connection#connection#${connectionId}`,
                sk: `graphql-ws-connection#${connectionId}`
              }
            }),
            {
              abortSignal
            }
          )

          break
        }
        default: {
          return {
            statusCode: 400
          }
        }
      }

    return {
      statusCode: 200
    }
  } catch (error) {
    log.error({ event }, error)
    return {
      statusCode: abortSignal.aborted ? 408 : 500
    }
  }
})

async function connectionSubscriptionsQueryOnce({
  limit,
  dynamodb,
  connectionId,
  exclusiveStartKey,
  abortSignal
}) {
  const { Items: items = [], LastEvaluatedKey: lastEvaluatedKey } =
    await dynamodb.send(
      new QueryCommand({
        TableName: process.env.DYNAMODB_TABLE,
        IndexName: 'gsi1',
        KeyConditionExpression: '#gsi1pk = :gsi1pk',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
          '#gsi1pk': 'gsi1pk'
        },
        ExpressionAttributeValues: {
          ':gsi1pk': `graphql-ws-connection#id#${connectionId}`
        },
        Limit: limit,
        ProjectionExpression: '#pk, #sk',
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey })
      }),
      {
        abortSignal
      }
    )
  return { items, lastEvaluatedKey }
}

async function* connectionSubscriptions({
  limit,
  dynamodb,
  connectionId,
  abortSignal
}) {
  let subscriptions = await connectionSubscriptionsQueryOnce({
    limit,
    dynamodb,
    connectionId
  })
  if (subscriptions.items?.length) yield subscriptions.items
  while (subscriptions.lastEvaluatedKey) {
    subscriptions = await connectionSubscriptionsQueryOnce({
      limit,
      dynamodb,
      connectionId,
      exclusiveStartKey: subscriptions.lastEvaluatedKey,
      abortSignal
    })
    if (subscriptions.items?.length) yield subscriptions.items
  }
}
