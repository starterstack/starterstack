import '../http.js'
import { execute } from 'graphql'
import validate from '../validate.js'
import filterErrors from '../filter-errors.js'
import ApplicationError from '../application-error.js'
import lambdaHandler, { prefix } from '../lambda-handler.js'
import createInvokeLambda from '../create-invoke-lambda.js'
import parseQuery from '../parse.js'
import permissions from '../permissions.js'

export const handler = ({ schema, schemaName }) =>
  lambdaHandler(async function httpHandler(
    event,
    context,
    { log, abortSignal, bodyParser, headerParser, correlationIds, jsonParse }
  ) {
    log.debug({ event }, 'received')

    const headers = headerParser()
    const method = event.requestContext?.httpMethod
    const start = Date.now()

    try {
      const contextValue = {
        requestSchema: schemaName,
        ...event.requestContext?.authorizer,
        ...permissions(event.requestContext?.authorizer),
        abortSignal,
        correlationIds,
        log,
        stage: event.requestContext?.stage,
        invokeLambda: createInvokeLambda({
          context,
          prefix,
          log
        }),
        setCacheAge(age) {
          if (method === 'GET') {
            if (contextValue.cacheAge === undefined) {
              contextValue.cacheAge = age
            } else if (age < contextValue) {
              contextValue.cacheAge = age
            }
          }
        },
        origin: headers?.origin ?? '',
        transport: `http:${method}`
      }

      const { queryStringParameters } = event

      const { query, variables, operationName } =
        method === 'GET' ? queryStringParameters : bodyParser.json()

      const root = {}

      const ast = parseQuery({ query, log })

      const validationErrors = await validate({
        schema,
        ast,
        context: {
          ...contextValue
        },
        variables
      })

      if (validationErrors?.length) {
        log.error({ event, query, errors: validationErrors })
        throw new ApplicationError('Invalid query', {
          code: 'invalidGraphQLQuery'
        })
      }

      const result = await execute({
        schema,
        document: ast,
        rootValue: root,
        contextValue,
        variableValues:
          typeof variables === 'string' ? jsonParse(variables) : variables,
        operationName
      })

      const hasErrors = result?.errors?.length

      if (hasErrors) {
        log.error({ event, query, result, errors: result.errors })
        result.errors = filterErrors(result.errors)
      }

      return {
        statusCode: hasErrors ? (abortSignal.aborted ? 408 : 400) : 200,
        body: JSON.stringify(result),
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'Cache-Control': contextValue.cacheAge
            ? `s-max-age=${contextValue.cacheAge}, max-age=0`
            : 'no-cache',
          'Server-Timing': `graphql;dur=${Date.now() - start}`
        }
      }
    } catch (error) {
      log.error(
        {
          headers,
          method,
          body: bodyParser.text() || event.queryStringParameters,
          event
        },
        error
      )
      return {
        statusCode: abortSignal.aborted ? 408 : 400,
        body: JSON.stringify({ errors: filterErrors([error]) }),
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'Cache-Control': 'no-cache',
          'Server-Timing': `graphql;dur=${Date.now() - start}`
        }
      }
    }
  })
