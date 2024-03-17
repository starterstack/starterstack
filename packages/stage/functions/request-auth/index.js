import process from 'node:process'
import './http.js'
import { Buffer } from 'node:buffer'
import jwt from 'jsonwebtoken'
import dynamodb from './dynamodb.js'
import ssm from './ssm.js'
import { GetCommand } from '@aws-sdk/lib-dynamodb'
import lambdaHandler from './lambda-handler.js'
import roleMapping from './role-mapping.js'

const { SSM_API_JWT_SECRET, DYNAMODB_TABLE } = process.env

function getTokenVersion(token) {
  try {
    const { v: version } = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64'),
      function stripProto(key, value) {
        if (key === '__proto__' || key === 'constructor') {
          throw new Error(`${key} prototype pollution detected`)
        } else {
          return value
        }
      }
    )
    if (version) {
      return String(version)
    }
  } catch {
    // eslint-disable-next-line no-empty
  }
}

export const httpAuth = lambdaHandler(async function httpAuth(
  event,
  context,
  { abortSignal, log }
) {
  return await httpAuthPayload({ event, context, abortSignal, log })
})

export const webSocketAuth = lambdaHandler(async function webSocketAuth(
  event,
  context,
  { abortSignal, log }
) {
  return await websocketAuthPayload({ event, context, abortSignal, log })
})

export const httpAnonymousAuth = lambdaHandler(async function httpAnonymousAuth(
  event,
  context,
  { abortSignal, log }
) {
  return await httpAuthPayload({
    event,
    context,
    abortSignal,
    log,
    allowAnonymous: true
  })
})

export const webSocketAnonymousAuth = lambdaHandler(
  async function webSocketAnonymousAuth(event, context, { abortSignal, log }) {
    return await websocketAuthPayload({
      event,
      context,
      abortSignal,
      log,
      allowAnonymous: true
    })
  }
)

async function httpAuthPayload({ event, abortSignal, log, allowAnonymous }) {
  log.debug({ event }, 'received')
  try {
    return await auth({
      token:
        event.cookies?.find((cookie) => cookie?.includes('token=')) ??
        Object.entries(event.multiValueHeaders || {})
          ?.find(([key]) => key.toLowerCase() === 'cookie')?.[1]
          ?.find((cookie) => cookie?.includes('token=')),
      sourceArn: event.routeArn ?? event.methodArn,
      allowAnonymous,
      abortSignal,
      log
    })
  } catch (error) {
    log.error({ event }, error)
    throw error
  }
}

async function websocketAuthPayload({
  event,
  abortSignal,
  log,
  allowAnonymous
}) {
  log.debug({ event }, 'received')
  const headers = Object.entries(event.multiValueHeaders ?? {})
  const cookieToken = headers
    ?.find(([key]) => key.toLowerCase() === 'cookie')?.[1]
    ?.find((cookie) => cookie?.includes('token='))
  const webSocketProtocol = headers?.find(
    ([key]) => key.toLowerCase() === 'sec-websocket-protocol'
  )?.[1]?.[0]

  const requestUrl = headers?.find(
    ([key]) => key.toLowerCase() === 'x-url'
  )?.[1]?.[0]

  try {
    return await auth({
      token: cookieToken,
      sourceArn: event.methodArn,
      allowAnonymous,
      webSocketProtocol,
      requestUrl,
      abortSignal,
      log
    })
  } catch (error) {
    log.error({ event }, error)
    throw error
  }
}

async function session({ ref, abortSignal }) {
  const { Item: { ttl, email } = {} } = await dynamodb.send(
    new GetCommand({
      TableName: DYNAMODB_TABLE,
      Key: {
        pk: `session#${ref}`,
        sk: `session#${ref}`
      },
      ExpressionAttributeNames: {
        '#ttl': 'ttl',
        '#email': 'email'
      },
      ProjectionExpression: '#ttl, #email'
    }),
    {
      abortSignal
    }
  )

  if (ttl && ttl * 1000 - Date.now() > 0) {
    return { email }
  }
  return {}
}

async function auth({
  allowAnonymous,
  token,
  webSocketProtocol,
  requestUrl,
  sourceArn,
  log,
  abortSignal
}) {
  const tokenData = token
    ? await verifyToken(token.match(/token=([^;]+)/)?.[1] ?? '', {
        abortSignal
      })
    : {}

  const { v, role, ref } = tokenData

  const tokenAllowed = v && (allowAnonymous || role)

  delete tokenData.v
  delete tokenData.iat
  delete tokenData.exp

  const needsSession = role && Number(role) !== 0
  const { email } =
    ref && tokenAllowed ? await session({ ref, abortSignal }) : {}

  const authorizerWildcardArn = `${sourceArn.split('/')[0]}/*`

  const allowed = needsSession ? tokenAllowed && email : tokenAllowed

  const roles = Object.entries(roleMapping)
    .map(
      ([key, value]) => (Number(role) & Number(key)) === Number(key) && value
    )
    .filter(Boolean)
    .join(',')

  const context = Object.entries({
    ...tokenData,
    ...(webSocketProtocol && { webSocketProtocol }),
    ...(requestUrl && { requestUrl }),
    email,
    roles
  }).reduce((sum, [key, value]) => {
    if (value) {
      sum[key] = String(value)
    }
    return sum
  }, {})

  const policy = {
    principalId: 'user',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: allowed ? 'Allow' : 'Deny',
          Resource: authorizerWildcardArn
        }
      ].filter(Boolean)
    },
    context
  }

  log.debug({ policy }, 'policy')

  return policy
}

async function getSecretForToken(token, { abortSignal }) {
  const tokenVersion = getTokenVersion(token)
  if (!tokenVersion) return

  const {
    [`${SSM_API_JWT_SECRET}`]: { value: secretValue }
  } = await ssm.get({
    name: `${SSM_API_JWT_SECRET}:${tokenVersion}`,
    abortSignal
  })

  return secretValue
}

async function verifyToken(token, { abortSignal }) {
  const apiSecret = await getSecretForToken(token, { abortSignal })
  const apiSecretPrefix = 'cf:'

  if (!apiSecret) return {}

  return await new Promise((resolve) => {
    jwt.verify(
      token,
      `${apiSecretPrefix}${apiSecret}`,
      { algorithms: ['HS256'] },
      (err, data) => {
        if (err) {
          resolve({})
        } else {
          resolve(data)
        }
      }
    )
  })
}
