import ApplicationError from './application-error.js'
import { InvokeCommand } from '@aws-sdk/client-lambda'
import createLambdaClient from './lambda.js'

const lambda = createLambdaClient()

export default function createInvokeLambda({ context, prefix, log } = {}) {
  return async function invokeLambda(
    serviceName,
    functionName,
    { root, args, context: contextValue, ast } = {}
  ) {
    if (!serviceName) throw new Error('service name missing')
    if (!functionName) throw new Error('function name missing')
    if (!args) throw new Error('args is missing')
    if (!contextValue) throw new Error('context is missing')

    const lambdaSplit = contextValue.correlationIds[prefix.lambda]?.split('-')
    const serviceIndex = lambdaSplit.indexOf('graphql')
    const stack = lambdaSplit.slice(0, serviceIndex).join('-')
    const invokePayload = {
      root,
      args,
      context: {
        ...contextValue,
        getRemainingTimeInMillis: context.getRemainingTimeInMillis() - 50
      },
      ...(ast && {
        ast: {
          ...ast,
          schema: undefined
        }
      })
    }

    const {
      StatusCode: statusCode,
      Payload: payload,
      FunctionError: functionError
    } = await lambda.send(
      new InvokeCommand({
        FunctionName: `${stack}-${serviceName}-${contextValue.stage}-${functionName}`,
        InvocationType: 'RequestResponse',
        LogType: 'None',
        Qualifier: '$LATEST',
        Payload: JSON.stringify(invokePayload)
      }),
      {
        abortSignal: contextValue.abortSignal
      }
    )

    const parsedResponse = JSON.parse(new TextDecoder('utf8').decode(payload))

    if (statusCode !== 200 || functionError) {
      const error = new Error('lambda invoke failed')
      log.error(
        {
          serviceName,
          functionName,
          invokePayload,
          parsedResponse,
          statusCode
        },
        error
      )
      throw error
    } else if (parsedResponse.applicationError) {
      const { message, extensions } = parsedResponse.applicationError
      throw new ApplicationError(
        message,
        extensions ?? {},
        extensions ? extensions.extendedMessage : undefined
      )
    }

    if (parsedResponse?.cacheAge) {
      contextValue.setCacheAge(parsedResponse.cacheAge)
    }
    return parsedResponse?.value
  }
}
