import process from 'node:process'
import './http.js'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import eventBridge, { assertFailedEntries } from './eventbridge.js'
import ssm from './ssm.js'
import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { PutEventsCommand } from '@aws-sdk/client-eventbridge'
import dynamodb from './dynamodb.js'
import ApplicationError from './application-error.js'
import lambdaHandler from './lambda-handler.js'

const {
  SSM_API_JWT_SECRET,
  DYNAMODB_STACK_TABLE,
  BASE_URL,
  EVENTBRIDGE_BUS_NAME,
  TEAM
} = process.env

export const handler = lambdaHandler(async function login(
  event,
  _,
  { abortSignal, log, bodyParser, headerParser }
) {
  log.debug({ event }, 'received')

  const headers = headerParser()
  const acceptHtml = headers.accept?.match(/text\/html/i)

  try {
    const { taskToken } = event.queryStringParameters ?? {}
    const search = bodyParser.form()

    const email = search.get('email')?.trim()?.toLowerCase()

    if (!email?.includes('@')) {
      throw new ApplicationError('invalid email', { code: 'invalidEmail' })
    }

    const {
      [SSM_API_JWT_SECRET]: { value: apiSecret, version: apiSecretVersion } = {}
    } = await ssm.get({
      name: SSM_API_JWT_SECRET,
      abortSignal
    })

    if (!apiSecret) {
      throw new Error('api secret cannot be blank')
    }

    const okResponse = {
      statusCode: 204,
      headers: {
        'Cache-Control': 'no-cache'
      }
    }

    const id = crypto.createHash('sha512').update(email).digest('hex')

    const nonce = crypto.randomBytes(12)

    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      crypto.createHash('sha256').update(apiSecret).digest(),
      nonce
    )

    const encryptedEmail = [
      cipher.update(email, 'binary', 'hex'),
      cipher.final('hex')
    ].join('')

    const {
      Items: [{ attempt = 0 } = {}]
    } = await dynamodb.send(
      new QueryCommand({
        TableName: DYNAMODB_STACK_TABLE,
        KeyConditionExpression: '#pk = :pk and #sk = :sk',
        FilterExpression: '#ttl > :now',
        Limit: 1,
        ConsistentRead: true,
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
          '#ttl': 'ttl',
          '#attempt': 'attempt'
        },
        ExpressionAttributeValues: {
          ':pk': `user#${id}#attempts`,
          ':sk': `user#${id}#attempts`,
          ':now': Math.floor(Date.now() / 1000)
        },
        ProjectionExpression: '#attempt'
      }),
      {
        abortSignal
      }
    )

    if (attempt > 3) {
      log.error(
        { event },
        new ApplicationError('too many attempts', {
          code: 'userTemporaryLocked'
        })
      )
      return okResponse
    }

    const token = await new Promise((resolve, reject) =>
      jwt.sign(
        {
          mfa: id,
          role: '0',
          s: Buffer.from(
            JSON.stringify({
              data: Buffer.from(encryptedEmail).toString('base64'),
              nonce: nonce.toString('base64'),
              tag: cipher.getAuthTag().toString('base64')
            })
          ).toString('base64'),
          v: apiSecretVersion
        },
        apiSecret,
        { expiresIn: '10minutes', algorithm: 'HS256' },
        (err, data) => (err ? reject(err) : resolve(data))
      )
    )

    const baseUrl = BASE_URL

    assertFailedEntries(
      await eventBridge.send(
        new PutEventsCommand({
          Entries: [
            {
              EventBusName: EVENTBRIDGE_BUS_NAME,
              Source: 'email',
              DetailType: 'login/signup',
              Detail: JSON.stringify({
                loginUrl: `${baseUrl}/session?token=${encodeURIComponent(
                  token
                )}`,
                team: TEAM,
                email,
                correlationId: crypto.randomUUID(),
                taskToken
              })
            }
          ]
        }),
        {
          abortSignal
        }
      )
    )

    return okResponse
  } catch (error_) {
    log.error({ headers, body: bodyParser.text(), event }, error_)

    const statusCode = abortSignal.aborted ? 408 : 400

    if (acceptHtml) {
      const errorMessage =
        error_ instanceof ApplicationError || 'Internal system error'
      return {
        statusCode,
        headers: {
          'Content-Type': 'text/html; charset=UTF-8',
          'Cache-Control': 'no-cache'
        },
        body: `<meta name="viewport" content="width=device-width,initial-scale=1">
        <h4>Sorry login failed.</h4>
        <p style="color: red">Error: ${errorMessage}</p>
        <a href='/hello'>Try login again?</a>`
      }
    } else {
      const error =
        error_ instanceof ApplicationError
          ? error_
          : { message: 'Internal system error' }

      return {
        statusCode,
        headers: {
          'Cache-Control': 'no-cache',
          'Content-Type': 'application/json; charset=UTF-8'
        },
        body: JSON.stringify(error)
      }
    }
  }
})
