import process from 'node:process'
import './http.js'
import { Buffer } from 'node:buffer'
import jwt from 'jsonwebtoken'
import dynamodb from './dynamodb.js'
import ssm from './ssm.js'
import { GetCommand } from '@aws-sdk/lib-dynamodb'
import lambdaHandler from './lambda-handler.js'
import {
  GetUsagePlansCommand,
  GetUsagePlanKeysCommand
} from '@aws-sdk/client-api-gateway'
import createApiGatewayClient from './apigateway.js'
import { roleValues } from './role-mapping.js'

const { SSM_API_JWT_SECRET } = process.env
const apiKeys = {}

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
      publicApi: Object.entries(event.multiValueHeaders || {})?.find(
        ([key]) => key.toLowerCase() === 'x-api'
      )?.[1],
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
  const { Item: { scope, ttl, access, deviceId, platformId, usagePlan } = {} } =
    await dynamodb.send(
      new GetCommand({
        TableName: process.env.DYNAMODB_TABLE,
        Key: {
          pk: `session#${ref}`,
          sk: `session#${ref}`
        },
        ExpressionAttributeNames: {
          '#scope': 'scope',
          '#ttl': 'ttl',
          '#access': 'access',
          '#platformId': 'platformId',
          '#deviceId': 'deviceId',
          '#usagePlan': 'usagePlan'
        },
        ProjectionExpression:
          '#scope, #access, #platformId, #deviceId, #ttl, #usagePlan'
      }),
      {
        abortSignal
      }
    )

  if (ttl && ttl * 1000 - Date.now() > 0) {
    return { scope, access, platformId, deviceId, usagePlan }
  }
}

async function auth({
  allowAnonymous,
  publicApi,
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

  const { v, role, ref, aud } = tokenData

  const tokenAllowed = process.env.IS_OFFLINE
    ? allowAnonymous || role
    : v && (allowAnonymous || role)

  delete tokenData.v
  delete tokenData.iat
  delete tokenData.exp

  const { scope, access, platformId, deviceId, usagePlan } =
    ref && tokenAllowed ? (await session({ ref, abortSignal })) ?? {} : {}

  const needsSession = role && Number(role) !== 0

  const authorizerWildcardArn =
    publicApi && access
      ? `${sourceArn.split('/').slice(0, 2).join('/')}/*/${access}/*`
      : `${sourceArn.split('/')[0]}/*`

  const denyWildcardArns = getDenyWildcardArns({
    access,
    role,
    allowAnonymous,
    aud,
    authorizerWildcardArn,
    publicApi
  })

  const allowed = needsSession ? tokenAllowed && access : tokenAllowed

  const context = Object.entries({
    ...tokenData,
    ...(webSocketProtocol && { webSocketProtocol }),
    ...(requestUrl && { requestUrl }),
    ...(scope && { scope }),
    ...(access && { access }),
    ...(platformId && { platformId }),
    ...(deviceId && { deviceId })
  }).reduce((sum, [key, value]) => {
    if (value) {
      sum[key] = String(value)
    }
    return sum
  }, {})

  const usageIdentifierKey =
    !process.env.IS_OFFLINE &&
    publicApi &&
    (await getUsageIdentifierKey({
      plan: usagePlan ?? 'basic',
      sourceArn,
      publicApi,
      abortSignal
    }))

  if (publicApi && !process.env.IS_OFFLINE && !usageIdentifierKey) {
    log.error(
      { sourceArn },
      new Error(`no api key found with plan ${usagePlan ?? 'basic'}`)
    )
  }

  const policy = {
    principalId: 'user',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: allowed ? 'Allow' : 'Deny',
          Resource: authorizerWildcardArn
        },
        ...denyWildcardArns.map(function denyWildcardArn(arn) {
          return {
            Action: 'execute-api:Invoke',
            Effect: 'Deny',
            Resource: arn
          }
        })
      ].filter(Boolean)
    },
    context,
    ...(usageIdentifierKey && {
      usageIdentifierKey
    })
  }

  log.debug({ policy }, 'policy')

  return policy
}

async function getUsageIdentifierKey({
  plan,
  sourceArn,
  publicApi,
  abortSignal
}) {
  if (apiKeys[plan]) {
    return apiKeys[plan]
  } else {
    const client = createApiGatewayClient()
    const [, stage] = sourceArn.split('/')
    let position
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await client.send(
        new GetUsagePlansCommand({ ...(position && { position }) }),
        { abortSignal }
      )
      for (const item of result.items) {
        if (item.name.includes(`${publicApi}-api-${plan}-${stage}`)) {
          const result = await client.send(
            new GetUsagePlanKeysCommand({
              usagePlanId: item.id,
              limit: 1
            }),
            { abortSignal }
          )
          if (result.items.length === 1) {
            apiKeys[plan] = result.items[0].value
          }
        }
      }
      if (result.position) {
        position = result.position
      } else {
        break
      }
    }
  }
  return apiKeys[plan]
}

function getDenyWildcardArns({
  access,
  aud,
  role,
  allowAnonymous,
  authorizerWildcardArn,
  publicApi
}) {
  if (publicApi && !allowAnonymous) {
    if ((Number(role) & roleValues.apischema) !== roleValues.apischema) {
      return [
        `${authorizerWildcardArn}login`,
        `${authorizerWildcardArn}logout`,
        `${authorizerWildcardArn}schema.json`
      ]
    }
    return []
  } else if (access === 'booking' && aud === 'user') {
    return [`${authorizerWildcardArn}api-graphql/backoffice*`]
  } else if (access) {
    return []
  } else {
    return [`${authorizerWildcardArn}api-graphql/*`]
  }
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
  const apiSecretPrefix = process.env.IS_OFFLINE ? '' : 'cf:'

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
