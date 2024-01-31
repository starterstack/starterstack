'use strict'

const process = require('node:process')
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda')
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand
} = require('@aws-sdk/lib-dynamodb')
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb')
const settings = require('../settings')
const path = require('node:path')
const fs = require('node:fs')
const { stackName, dynamodbStackTable } = settings({
  options: { stage: 'local' }
})

const lambda = new LambdaClient({
  endpoint: 'http://localhost:4010',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'x',
    secretAccessKey: 'x'
  }
})

const dynamodb = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    endpoint: 'http://localhost:8000',
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'x',
      secretAccessKey: 'x'
    }
  })
)

const { __HANDLER: HANDLER } = process.env

const directory = path.join(
  process.cwd(),
  path.dirname(path.normalize(HANDLER))
)
const method = HANDLER.split('.').slice(-1)[0]
const file = path.basename(HANDLER, `.${method}`)

exports.webSocketAuth = async function authHandler(event, context) {
  try {
    const handler = await getHandler()
    return handler(await inject({ anonymous: false, event }), context)
  } catch (err) {
    console.error(err)
    if (err instanceof ForbiddenError) {
      return {
        statusCode: 403
      }
    } else {
      throw err
    }
  }
}

exports.webSocketAnonymousAuth = async function authHandler(event, context) {
  const handler = await getHandler()
  return handler(await inject({ anonymous: true, event }), context)
}

async function inject({ anonymous, event }) {
  const { connectionId, routeKey } = event.requestContext

  const searchToken = event?.multiValueQueryStringParameters?.token?.[0]

  if (searchToken) {
    event.multiValueHeaders.cookie = [`token=${searchToken}`]
  } else {
    if (event.multiValueHeaders) {
      event.multiValueHeaders.cookie = [
        event.headers?.cookie
          ?.split(';')
          ?.find((cookie) => cookie?.trim().startsWith('token='))
          ?.trim()
      ].filter(Boolean)
    }
  }

  const policyResponse =
    routeKey === '$connect'
      ? JSON.parse(
          new TextDecoder('utf-8').decode(
            (
              await lambda.send(
                new InvokeCommand({
                  FunctionName: `${stackName}-cdn-local-${
                    anonymous ? 'webSocketAnonymousAuth' : 'webSocketAuth'
                  }`,
                  InvocationType: 'RequestResponse',
                  LogType: 'None',
                  Qualifier: '$LATEST',
                  Payload: JSON.stringify({
                    ...event,
                    methodArn:
                      'arn:aws:execute-api:us-east-1:000000000000:xxxxxxxxxx/local/api/ws'
                  })
                })
              )
            ).Payload
          )
        )
      : (
          await dynamodb.send(
            new GetCommand({
              TableName: dynamodbStackTable,
              Key: {
                pk: `websocket-auth#connection#${connectionId}`,
                sk: `websocket-auth#connection#${connectionId}`
              }
            })
          )
        ).Item.policyResponse

  if (!policyResponse) {
    throw new ForbiddenError()
  }

  if (policyResponse.policyDocument.Statement[0].Effect !== 'Allow') {
    throw new ForbiddenError()
  } else {
    event.requestContext.authorizer = {
      principalId: policyResponse.principalId,
      ...policyResponse.context
    }
  }

  if (routeKey === '$connect') {
    await dynamodb.send(
      new PutCommand({
        TableName: dynamodbStackTable,
        Item: {
          pk: `websocket-auth#connection#${connectionId}`,
          sk: `websocket-auth#connection#${connectionId}`,
          policyResponse
        },
        ReturnValues: 'NONE'
      })
    )
  } else if (routeKey === '$disconnect') {
    await dynamodb.send(
      new DeleteCommand({
        TableName: dynamodbStackTable,
        Key: {
          pk: `websocket-auth#connection#${connectionId}`,
          sk: `websocket-auth#connection#${connectionId}`
        }
      })
    )
  }

  return event
}

class ForbiddenError extends Error {
  constructor() {
    super()
    Error.captureStackTrace(this, ForbiddenError)
  }
}

async function getHandler() {
  const config = await getHandlerConfig({ directory, file })
  return await getHandlerFn({ config, method })
}

async function getHandlerFn({ config, method }) {
  try {
    const fn = (
      config.type === 'cjs'
        ? require(config.file)
        : await import(`file://${config.file}`)
    )[method]
    if (!fn) {
      throw new TypeError('not found')
    }
    return fn
  } catch (err) {
    console.error(
      `failed to load ${JSON.stringify({ config, method }, null, 2)}`
    )
    throw err
  }
}

async function getHandlerConfig({ directory, file }) {
  const paths = {
    mjs: path.join(directory, `${file}.mjs`),
    js: path.join(directory, `${file}.js`),
    package: path.join(directory, 'package.json')
  }

  if (await fs.promises.stat(paths.mjs).catch(() => false)) {
    return {
      file: paths.mjs,
      type: 'esm'
    }
  }

  if (await fs.promises.stat(paths.package).catch(() => false)) {
    const { type: packageType } = JSON.parse(
      await fs.promises.readFile(paths.package, 'utf-8')
    )
    if (packageType === 'module') {
      return {
        file: paths.js,
        type: 'esm'
      }
    }
  }

  return {
    file: paths.js,
    type: 'cjs'
  }
}
