import process from 'node:process'
import '../http.js'
import { execute, parse } from 'graphql'
import schemas from '../schemas/index.js'
import { PK_MAX_SHARD } from './constants.js'
import { createApiGatewayManagementApi } from './apigateway.js'
import dynamodb from '../dynamodb.js'
import filterErrors from '../filter-errors.js'
import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { GoneException } from '@aws-sdk/client-apigatewaymanagementapi'
import lambdaHandler, { prefix } from '../lambda-handler.js'
import createInvokeLambda from '../create-invoke-lambda.js'

export const handler = lambdaHandler(async function broadcast(
  event,
  context,
  { log, abortSignal }
) {
  log.debug({ event }, 'received')

  try {
    const { topicKey, rootValue } = broadcastMapping(event)

    for await (const batch of topicSubscriptions({
      topicKey,
      limit: 25,
      abortSignal
    })) {
      await Promise.all(
        batch.map(async function publish({ connectionId, subscription }) {
          const { domainName, stage } = subscription
          // eslint-disable-next-line @typescript-eslint/unbound-method
          const { postToConnection, deleteConnection } =
            createApiGatewayManagementApi({
              connectionId,
              domainName,
              stage,
              abortSignal
            })

          try {
            const ast = parse(subscription.query)
            const schema = schemas[subscription?.context?.requestSchema]

            if (!schema) {
              await deleteConnection()
              throw new Error('no schema found')
            }
            const response = await execute({
              schema,
              document: ast,
              rootValue,
              contextValue: {
                ...subscription.context,
                abortSignal,
                invokeLambda: createInvokeLambda({
                  context,
                  prefix,
                  log
                })
              },
              setCacheAge() {},
              variableValues: subscription.variables
            })

            if (response?.errors?.length) {
              log.error({ errors: response.errors, event, subscription })
              await postToConnection({
                type: 'error',
                id: subscription.id,
                payload: filterErrors(response.errors)
              })
            } else {
              await postToConnection({
                type: 'next',
                id: subscription.id,
                payload: response
              })

              if (subscription.fireOnce) {
                await postToConnection({
                  type: 'complete',
                  id: subscription.id
                })
              }
            }
          } catch (error) {
            if (!(error instanceof GoneException)) {
              log.error({ subscription, event }, error)
              await deleteConnection()
            }
          }
        })
      )
    }
    return {}
  } catch (error) {
    log.error({ event }, error)
    throw error
  }
})

async function topicSubscriptionsQueryOnce({
  dynamodb,
  topicKey,
  limit,
  exclusiveStartKey,
  abortSignal
}) {
  const { Items: items = [], LastEvaluatedKey: lastEvaluatedKey } =
    await dynamodb.send(
      new QueryCommand({
        TableName: process.env.DYNAMODB_TABLE,
        IndexName: 'gsi2',
        KeyConditionExpression: '#gsi2pk = :gsi2pk',
        ExpressionAttributeNames: {
          '#gsi2pk': 'gsi2pk',
          '#subscription': 'subscription',
          '#connectionId': 'connectionId',
          '#pk': 'pk',
          '#sk': 'sk'
        },
        ExpressionAttributeValues: {
          ':gsi2pk': `graphql-ws-subscription#topic#${topicKey}`
        },
        ProjectionExpression: '#subscription, #connectionId, #pk, #sk',
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
        ...(limit && { Limit: limit })
      }),
      {
        abortSignal
      }
    )
  return { items, lastEvaluatedKey }
}

async function* topicSubscriptions({ topicKey, limit, abortSignal }) {
  let suffix = 0
  let subscriptions
  while (subscriptions?.lastEvaluatedKey || suffix < PK_MAX_SHARD) {
    subscriptions = await topicSubscriptionsQueryOnce({
      topicKey: `${topicKey}-${suffix}`,
      dynamodb,
      limit,
      exclusiveStartKey: subscriptions?.lastEvaluatedKey,
      abortSignal
    })
    if (subscriptions.items?.length) {
      yield subscriptions.items
    }
    if (!subscriptions.lastEvaluatedKey) {
      suffix++
    }
  }
}

function broadcastMapping(event) {
  if (event.source === 'upload') {
    const files = event?.detail?.files
    const s3Key = event?.detail?.s3Key
    return {
      topicKey: `upload:onReady:path#${s3Key}`,
      rootValue: {
        onReady: {
          files
        }
      }
    }
  } else {
    throw new TypeError('unknown event')
  }
}
