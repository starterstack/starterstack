import process from 'node:process'
import '../http.js'
import { subscribe } from 'graphql'
import validate from '../validate.js'
import schemas from '../schemas/index.js'
import { PK_MAX_SHARD } from './constants.js'
import { createApiGatewayManagementApi } from './apigateway.js'
import dynamodb from '../dynamodb.js'
import filterErrors from '../filter-errors.js'
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import lambdaHandler, { prefix } from '../lambda-handler.js'
import createInvokeLambda from '../create-invoke-lambda.js'
import ApplicationError from '../application-error.js'
import parseQuery from '../parse.js'
import ms from 'ms'
import permissions from '../permissions.js'

export const handler = lambdaHandler(async function wsHandler(
  event,
  context,
  { log, abortSignal, correlationIds, bodyParser }
) {
  log.debug({ event }, 'received')

  const { routeKey, connectionId, domainName, stage } =
    event.requestContext ?? {}

  try {
    const message = bodyParser.json()

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { postToConnection, deleteConnection } =
      createApiGatewayManagementApi({
        connectionId,
        domainName,
        stage,
        abortSignal
      })

    const contextValue = {
      ...event.requestContext?.authorizer,
      ...permissions(event.requestContext?.authorizer),
      stage: event.requestContext?.stage,
      transport: 'ws'
    }

    if (contextValue.requestUrl) {
      contextValue.requestSchema = contextValue.requestUrl.split('/').at(-1)
      if (contextValue.requestSchema === 'graphql') {
        contextValue.requestSchema = 'default'
      }
      delete contextValue.requestUrl
    }

    const schema = schemas[contextValue.requestSchema]

    const isGraphqlWS =
      contextValue.webSocketProtocol === 'graphql-transport-ws'

    if (isGraphqlWS && !schema) {
      await deleteConnection()
      throw new Error('no graphql schema found')
    }

    if (routeKey === 'complete') {
      await dynamodb.send(
        new DeleteCommand({
          TableName: process.env.DYNAMODB_TABLE,
          Key: {
            pk: `graphql-ws-subscription#id#${message.id}`,
            sk: `graphql-ws-subscription#id#${message.id}`
          }
        }),
        {
          abortSignal
        }
      )
    } else if (routeKey === 'subscribe') {
      try {
        const { Item: existing } = await dynamodb.send(
          new GetCommand({
            TableName: process.env.DYNAMODB_TABLE,
            Key: {
              pk: `graphql-ws-connection#connection#${connectionId}`,
              sk: `graphql-ws-connection#${connectionId}`
            },
            ExpressionAttributeNames: {
              '#pk': 'pk',
              '#sk': 'sk'
            },
            ProjectionExpression: '#pk, #sk'
          }),
          {
            abortSignal
          }
        )

        if (!existing) {
          await deleteConnection()
          return {
            statusCode: 200
          }
        }

        const ast = parseQuery({ query: message.payload.query, log })

        {
          const errors = await validate({
            schema,
            ast,
            context: {
              ...contextValue
            },
            variables: message.payload.variables
          })
          if (errors && errors.length > 0) {
            log.error({
              routeKey,
              connectionId,
              body: bodyParser.text(),
              errors
            })
            await postToConnection({
              type: 'error',
              id: message.id,
              payload: [
                new ApplicationError('Invalid query', {
                  code: 'invalidGraphQLQuery'
                })
              ]
            })
            return {
              statusCode: 200
            }
          }
        }
        const { errors = [], next } = await subscribe({
          schema,
          document: ast,
          variableValues: message.payload.variables,
          contextValue: {
            ...contextValue,
            abortSignal,
            correlationIds,
            invokeLambda: createInvokeLambda({
              context,
              prefix,
              log
            }),
            setCacheAge() {}
          },
          rootValue: {}
        })
        if (errors && errors.length > 0) {
          log.error({ routeKey, connectionId, body: bodyParser.text(), errors })
          await postToConnection({
            type: 'error',
            id: message.id,
            payload: filterErrors(errors)
          })
          return {
            statusCode: 200
          }
        }

        const {
          value: { topics, fireOnce }
        } = await next()
        const topicRandomSuffix = Math.floor(Math.random() * PK_MAX_SHARD)

        const topicArguments = (args) => {
          const sorted = [...args].sort((a, b) => a.name.localeCompare(b.name))
          return sorted.map((arg) => `${arg.name}#${arg.value}`).join('/')
        }

        await Promise.all(
          [...topics.entries()].map(function createTopicSubscription([
            index,
            { topicName, args, root }
          ]) {
            return dynamodb.send(
              new PutCommand({
                TableName: process.env.DYNAMODB_TABLE,
                Item: {
                  pk: `graphql-ws-subscription#id#${message.id}`,
                  sk: `graphql-ws-subscription#id#${message.id}#${index}`,
                  userId: contextValue.id,
                  connectionId,
                  gsi1pk: `graphql-ws-connection#id#${connectionId}`,
                  gsi2pk: `graphql-ws-subscription#topic#${topicName}:${topicArguments(
                    args
                  )}-${topicRandomSuffix}`,
                  topicName,
                  root,
                  subscription: {
                    ...message.payload,
                    context: contextValue,
                    id: message.id,
                    domainName,
                    stage,
                    fireOnce
                  },
                  correlationIds,
                  subscriptionId: message.id,
                  type: 'graphql-ws-subscription',
                  ttl: Math.floor((Date.now() + ms('2 hours')) / 1000)
                },
                ConditionExpression: 'attribute_not_exists(pk)',
                ReturnValues: 'NONE'
              }),
              {
                abortSignal
              }
            )
          })
        )
        await postToConnection({
          type: 'pong',
          payload: {
            subscriptionId: message.id
          }
        })
      } catch (error) {
        log.error({ routeKey, connectionId, body: bodyParser.text() }, error)
        await deleteConnection()
      }
    } else {
      await deleteConnection()
    }
    return {
      statusCode: 200
    }
  } catch (error) {
    log.error({ routeKey, connectionId, body: bodyParser.text(), event }, error)
    return {
      statusCode: abortSignal.aborted ? 408 : 400
    }
  }
})
