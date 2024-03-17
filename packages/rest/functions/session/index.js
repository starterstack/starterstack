import process from 'node:process'
import { Buffer } from 'node:buffer'
import './http.js'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import * as OTPAuth from 'otpauth'
import qrcode from 'qrcode'
import ssm from './ssm.js'
import dynamodb from './dynamodb.js'

import {
  QueryCommand,
  GetCommand,
  UpdateCommand,
  PutCommand,
  DeleteCommand
} from '@aws-sdk/lib-dynamodb'
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'

import lambdaHandler from './lambda-handler.js'
import ApplicationError from './application-error.js'
import ms from 'ms'

const {
  SSM_API_JWT_SECRET,
  SSM_API_MFA_SECRET,
  DYNAMODB_STACK_TABLE,
  MFA_TITLE
} = process.env

export const handler = lambdaHandler(async function session(
  event,
  _,
  { abortSignal, log, headerParser, bodyParser }
) {
  log.debug({ event }, 'received')

  const headers = headerParser()
  const method = event.requestContext?.httpMethod

  const acceptHtml = headers.accept?.match(/text\/html/i)

  const {
    requestContext: { authorizer: { s, mfa: id } = {} }
  } = event

  try {
    if (!s && !id) {
      throw new ApplicationError(
        'Invalid token sorry, your token has most likely expired.',
        {
          code: 'invalidJwtToken'
        }
      )
    }

    const {
      [`${SSM_API_JWT_SECRET}`]: {
        value: apiSecret,
        version: apiSecretVersion
      } = {},
      [`${SSM_API_MFA_SECRET}`]: {
        value: mfaSecret,
        version: mfaSecretVersion
      } = {}
    } = await ssm.get({
      names: [SSM_API_JWT_SECRET, SSM_API_MFA_SECRET],
      abortSignal
    })

    if (!apiSecret) {
      throw new Error('api secret cannot be blank')
    }

    if (!mfaSecret) {
      throw new Error('mfa secret cannot be blank')
    }

    const encrypted = JSON.parse(Buffer.from(s, 'base64'))

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      crypto.createHash('sha256').update(apiSecret).digest(),
      Buffer.from(encrypted.nonce, 'base64')
    )

    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'))
    const email = [
      decipher.update(
        Buffer.from(encrypted.data, 'base64').toString(),
        'hex',
        'utf8'
      ),
      decipher.final('utf8')
    ].join('')

    const [
      { Item: { role = new Set([1]), mfa: assignedMfa, verified } = {} },
      {
        Items: [{ attempt = 0 } = {}]
      }
    ] = await Promise.all([
      dynamodb.send(
        new GetCommand({
          TableName: DYNAMODB_STACK_TABLE,
          Key: {
            pk: `user#${id}`,
            sk: `user#${id}`
          },
          ExpressionAttributeNames: {
            '#role': 'role',
            '#mfa': 'mfa',
            '#verified': 'verified'
          },
          ProjectionExpression: '#role, #mfa, #verified'
        }),
        {
          abortSignal
        }
      ),

      dynamodb.send(
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
    ])

    if (attempt > 3) {
      throw new ApplicationError(
        'Too many attempts. Please try again in 10 minutes',
        { code: 'userTemporaryLocked' }
      )
    }

    try {
      await dynamodb.send(
        new PutCommand({
          TableName: DYNAMODB_STACK_TABLE,
          Item: {
            pk: `user#${id}#attempts`,
            sk: `user#${id}#attempts`,
            ttl: Math.floor((Date.now() + ms('10 minutes')) / 1000),
            attempt: 0
          },
          ExpressionAttributeValues: {
            ':now': Math.floor(Date.now() / 1000)
          },
          ExpressionAttributeNames: {
            '#ttl': 'ttl'
          },
          ConditionExpression: 'attribute_not_exists(pk) or #ttl < :now',
          ReturnValues: 'NONE'
        }),
        {
          abortSignal
        }
      )
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) {
        throw error
      }
    }

    const createSession = async function createSession() {
      const roleValue = Number([...role].reduce((a, b) => a | b))

      const sessionRef = crypto.randomUUID()

      const expiresIn = '12 hours'

      const [sessionToken] = await Promise.all([
        new Promise((resolve, reject) =>
          jwt.sign(
            {
              ref: sessionRef,
              role: roleValue,
              id: id,
              v: apiSecretVersion
            },
            apiSecret,
            {
              expiresIn,
              audience: 'user',
              algorithm: 'HS256'
            },
            (err, data) => (err ? reject(err) : resolve(data))
          )
        ),
        dynamodb.send(
          new PutCommand({
            TableName: DYNAMODB_STACK_TABLE,
            Item: {
              pk: `session#${sessionRef}`,
              sk: `session#${sessionRef}`,
              gsi2pk: `session#${id}`,
              gsi2sk: Date.now().toString(32),
              ttl: Math.floor((Date.now() + ms(expiresIn)) / 1000),
              email
            },
            ReturnValues: 'NONE'
          }),
          {
            abortSignal
          }
        )
      ])

      const tokenCookie = `token=${sessionToken}; Path=/; HttpOnly; SameSite=Strict; Secure; Expires=${new Date(
        Date.now() + ms(expiresIn)
      ).toGMTString()}`

      return tokenCookie
    }

    if (method === 'GET') {
      const response = {}

      if (!verified) {
        const { mfa, otpSecret } = getOtp({
          mfaSecret,
          mfaSecretVersion,
          assignedMfa
        })
        const otpauth = new OTPAuth.TOTP({
          issuer: MFA_TITLE,
          label: email,
          secret: OTPAuth.Secret.fromBase32(otpSecret),
          digits: 6,
          period: 30
        })
        const qrcodeDataUrl = await new Promise((resolve, reject) => {
          qrcode.toDataURL(otpauth.toString(), (err, dataUrl) => {
            if (err) return reject(err)
            resolve(dataUrl)
          })
        })

        await dynamodb.send(
          new UpdateCommand({
            TableName: DYNAMODB_STACK_TABLE,
            Key: {
              pk: `user#${id}`,
              sk: `user#${id}`
            },
            UpdateExpression: 'set #mfa = if_not_exists(#mfa, :mfa)',
            ExpressionAttributeNames: {
              '#mfa': 'mfa'
            },
            ExpressionAttributeValues: {
              ':mfa': mfa
            },
            ReturnValues: 'NONE'
          }),
          {
            abortSignal
          }
        )

        response.qrcode = qrcodeDataUrl
        response.secret = otpSecret
      }

      return {
        statusCode: 200,
        headers: {
          'Cache-Control': 'no-cache',
          'Content-Type': 'application/json; charset=UTF-8'
        },
        body: JSON.stringify(response)
      }
    } else if (method === 'POST') {
      if (!assignedMfa) {
        throw new Error('no mfa code found for user')
      }

      await dynamodb.send(
        new UpdateCommand({
          TableName: DYNAMODB_STACK_TABLE,
          Key: {
            pk: `user#${id}#attempts`,
            sk: `user#${id}#attempts`
          },
          UpdateExpression: 'add #attempt :inc',
          ExpressionAttributeNames: {
            '#attempt': 'attempt'
          },
          ExpressionAttributeValues: {
            ':inc': 1
          },
          ReturnValues: 'NONE'
        }),
        {
          abortSignal
        }
      )

      const searchParams = bodyParser.form()

      const code = searchParams.get('code')

      const { otpSecret } = getOtp({
        mfaSecret,
        mfaSecretVersion,
        assignedMfa
      })

      const otpauth = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(otpSecret),
        digits: 6,
        period: 30
      })

      const delta = otpauth.validate({ token: code })

      if (![0, -1].includes(delta)) {
        throw new ApplicationError('invalid mfa code', { code: 'invalidOtp' })
      }

      await Promise.all([
        dynamodb.send(
          new DeleteCommand({
            TableName: DYNAMODB_STACK_TABLE,
            Key: {
              pk: `user#${id}#attempts`,
              sk: `user#${id}#attempts`
            },
            ReturnValues: 'NONE'
          }),
          {
            abortSignal
          }
        ),

        dynamodb.send(
          new UpdateCommand({
            TableName: DYNAMODB_STACK_TABLE,
            Key: {
              pk: `user#${id}`,
              sk: `user#${id}`
            },
            UpdateExpression:
              'set #verified = if_not_exists(#verified, :verified), #email = if_not_exists(#email, :email), #role = if_not_exists(#role, :role), #type = if_not_exists(#type, :type)',
            ExpressionAttributeNames: {
              '#verified': 'verified',
              '#email': 'email',
              '#role': 'role',
              '#type': 'type'
            },
            ExpressionAttributeValues: {
              ':verified': true,
              ':email': email,
              ':role': new Set([1]),
              ':type': 'user'
            },
            ReturnValues: 'NONE'
          }),
          {
            abortSignal
          }
        )
      ])
    }

    return {
      statusCode: acceptHtml ? 301 : 204,
      headers: {
        'Cache-Control': 'no-cache',
        ...(acceptHtml && { Location: '/hello' }),
        'Set-Cookie': await createSession()
      }
    }
  } catch (error_) {
    log.error({ headers, method, body: bodyParser.text(), event }, error_)

    const statusCode = abortSignal.aborted ? 408 : 401

    if (acceptHtml) {
      const errorMessage =
        (error_ instanceof ApplicationError && error_.message) ||
        'Internal system error'
      return {
        statusCode,
        headers: {
          'Cache-Control': 'no-cache',
          'Content-Type': 'text/html; charset=UTF-8'
        },
        body: `<meta name="viewport" content="width=device-width,initial-scale=1">
       <h4>Sorry session creation failed.</h4>
       <p style="color: red">Error: ${errorMessage}</p>
       <a href='/hello'>Try to login again?</a>`
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

function getOtp({ mfaSecret, mfaSecretVersion, assignedMfa }) {
  if (assignedMfa) {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      crypto.createHash('sha256').update(mfaSecret).digest(),
      Buffer.from(assignedMfa.nonce, 'base64')
    )

    decipher.setAuthTag(Buffer.from(assignedMfa.tag, 'base64'))
    const otpSecret = [
      decipher.update(assignedMfa.data, 'hex', 'utf8'),
      decipher.final('utf8')
    ].join('')

    return {
      mfa: assignedMfa,
      otpSecret
    }
  } else {
    const nonce = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      crypto.createHash('sha256').update(mfaSecret).digest(),
      nonce
    )

    const otpSecret = new OTPAuth.Secret({ size: 25 }).base32
    const encryptedSecret = [
      cipher.update(otpSecret, 'binary', 'hex'),
      cipher.final('hex')
    ].join('')

    return {
      mfa: {
        data: encryptedSecret,
        nonce: nonce.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        v: String(mfaSecretVersion)
      },
      otpSecret
    }
  }
}
