import process from 'node:process'
import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import dynamodb from './dynamodb.js'
import lambdaHandler from './lambda-handler.js'
import ms from 'ms'

export const handler = lambdaHandler(async function twilioStatus(
  event,
  context,
  { log, abortSignal }
) {
  log.debug({ event }, 'received')

  const {
    detail: { eventType, timestamp, correlationId, email }
  } = event

  const isoDate = timestamp.slice(0, 10)

  await Promise.all([
    dynamodb.send(
      new UpdateCommand({
        TableName: process.env.DYNAMODB_STATS_TABLE,
        Key: {
          pk: `email#count#${isoDate}`,
          sk: `email#count#${isoDate}`
        },
        UpdateExpression: `add #${eventType} :inc set #type=:type`,
        ExpressionAttributeNames: {
          [`#${eventType}`]: eventType,
          '#type': 'type'
        },
        ExpressionAttributeValues: {
          ':inc': 1,
          ':type': 'emailCounters'
        },
        ReturnValues: 'NONE'
      }),
      {
        abortSignal
      }
    ),

    dynamodb.send(
      new UpdateCommand({
        TableName: process.env.DYNAMODB_STATS_TABLE,
        Key: {
          pk: `email#tracking#${email}#${isoDate}`,
          sk: `email#tracking#${email}#${isoDate}`
        },
        UpdateExpression: 'add #events :events set #ttl=:ttl, #type=:type',
        ExpressionAttributeNames: {
          '#events': 'events',
          '#type': 'type',
          '#ttl': 'ttl'
        },
        ExpressionAttributeValues: {
          ':events': new Set([
            `Email ${eventType};${timestamp};${correlationId}`
          ]),
          ':ttl': Math.floor((Date.now() + ms('3 days')) / 1000),
          ':type': 'emailTracking'
        },
        ReturnValues: 'NONE'
      }),
      {
        abortSignal
      }
    )
  ])
  return {}
})
