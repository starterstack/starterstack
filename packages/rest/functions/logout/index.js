import process from 'node:process'
import lambdaHandler from './lambda-handler.js'
import { DeleteCommand } from '@aws-sdk/lib-dynamodb'
import dynamodb from './dynamodb.js'

export const handler = lambdaHandler(async function logout(
  event,
  context,
  { log, abortSignal }
) {
  log.debug({ event }, 'received')

  const ref = event?.requestContext?.authorizer?.ref
  const tokenCookie = `token=deleted; Path=/; HttpOnly; SameSite=Strict; Secure; Expires=${new Date(
    0
  ).toGMTString()}`

  try {
    if (ref) {
      await dynamodb.send(
        new DeleteCommand({
          TableName: process.env.DYNAMODB_STACK_TABLE,
          Key: {
            pk: `session#${ref}`,
            sk: `session#${ref}`
          },
          ReturnValues: 'NONE'
        }),
        {
          abortSignal
        }
      )
    }

    return {
      statusCode: 301,
      headers: {
        'Cache-Control': 'no-cache',
        'Set-Cookie': tokenCookie,
        Location: '/hello'
      }
    }
  } catch (error) {
    log.error({ event }, error)
    return {
      statusCode: abortSignal.aborted ? 408 : 400,
      headers: {
        'Cache-Control': 'no-cache',
        'Set-Cookie': tokenCookie
      }
    }
  }
})
