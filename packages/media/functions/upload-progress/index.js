import process from 'node:process'
import dynamodb from './dynamodb.js'
import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import ApplicationError from './application-error.js'

import lambdaHandler from './lambda-handler.js'

export const handler = lambdaHandler(async function uploadProgress(
  event,
  context,
  { log, abortSignal }
) {
  log.debug({ event }, 'received')

  const { id: userId, aud } = event?.context ?? {}
  const { key } = event.args

  try {
    if (!userId || aud !== 'user') {
      throw new ApplicationError('Not authorized', { code: 'notAuthorized' })
    }

    if (!key) {
      throw new ApplicationError('Missing key', { code: 'invalidKey' })
    }

    const {
      Items: [{ files = [] } = {}]
    } = await dynamodb.send(
      new QueryCommand({
        TableName: process.env.DYNAMODB_TABLE,
        KeyConditionExpression: '#pk = :pk and #sk = :sk',
        FilterExpression: '#userId = :userId',
        Limit: 1,
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
          '#files': 'files',
          '#userId': 'userId'
        },
        ExpressionAttributeValues: {
          ':pk': `upload#${key}`,
          ':sk': `upload#${key}`,
          ':userId': userId
        },
        ProjectionExpression: '#files'
      }),
      {
        abortSignal
      }
    )

    return {
      value: {
        files: (files ?? []).filter(function withoutWebp(file) {
          return !/web(p|m)$/i.test(file.path)
        })
      }
    }
  } catch (error) {
    if (error instanceof ApplicationError) {
      return { applicationError: error }
    }
    throw error
  }
})
