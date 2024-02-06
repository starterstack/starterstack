import process from 'node:process'
import { Buffer } from 'node:buffer'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import lambdaHandler from './lambda-handler.js'
import Sentry from '@sentry/node'
import './http.js'

const gunzip = promisify(zlib.gunzip)

export const handler = lambdaHandler(async function sentryTunnel(
  event,
  context,
  { log, jsonParse }
) {
  try {
    const { logEvents, logGroup, logStream } = jsonParse(
      await gunzip(Buffer.from(event.awslogs.data, 'base64'))
    )

    try {
      const from = logGroupFrom(logGroup)
      if (!from) return

      const errors = logEvents.map(function toJSON({ message }) {
        return jsonParse(message)
      })

      if (errors.length === 0) return

      const release = errors[0]['x-correlation-git-commit']

      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        normalizeDepth: 4,
        tracesSampleRate: 1,
        environment: process.env.SENTRY_ENVIRONMENT,
        ...(release && { release }),
        tunnel: process.env.SENTRY_TUNNEL
      })

      for (const error of errors) {
        const {
          exception,
          correlationId,
          userId,
          traceId,
          requestId,
          lambda,
          resource,
          httpStatus,
          wafStatus,
          extra
        } = parseError({ error, from, logGroup, logStream, jsonParse })
        Sentry.captureException(exception, {
          level: 'error',
          tags: {
            ...(process.env.SERVICE && { service: process.env.SERVICE }),
            correlationId,
            traceId,
            from,
            ...(lambda && { lambda }),
            ...(resource && { resource }),
            stage: process.env.STAGE,
            requestId,
            ...(httpStatus && { errorCode: `httpStatus:${httpStatus}` }),
            ...(wafStatus && { errorCode: `wafStatus:${wafStatus}` }),
            ...(error.extensions?.code && { errorCode: error.extensions.code })
          },
          extra: extra ?? error,
          ...(userId && { user: { id: userId } })
        })
      }
      await Sentry.flush(200)
    } catch (error) {
      log.error({ logEvents, logGroup, logStream }, error)
    }
  } catch (error) {
    log.error({ event }, error)
  }
})

function parseError({ error, from, logGroup, logStream, jsonParse }) {
  if (from === 'lambda') {
    return {
      exception: exception(error.msg, error.type),
      correlationId: error['x-correlation-id'],
      userId: error['x-correlation-user-id'],
      traceId: error['x-correlation-trace-id'],
      requestId: error['x-correlation-api-id'],
      lambda: error['x-correlation-lambda']
    }
  } else if (from === 'apigateway') {
    const httpStatus = error.status
    const resource = `${error.httpMethod}:${error.resourcePath}`
    return {
      exception: exception(`API Gateway Error:${resource}(${httpStatus})`),
      correlationId: error.requestId,
      ...(error.user !== '-' && { userId: error.user }),
      traceId: error.requestId,
      requestId: error.requestId,
      httpStatus,
      resource,
      extra: {
        ...error,
        'x-correlation-log-stream': `${logGroup}/${logStream}`
      }
    }
  } else if (from.startsWith('waf')) {
    const traceId = error.httpRequest?.headers?.find(
      function findTraceId(header) {
        return header.name === 'X-Amzn-Trace-Id'
      }
    )?.value

    const cookie = error.httpRequest?.headers?.find(function findToken(header) {
      return (header.name = 'Cookie' && header.value.startsWith('token='))
    })?.value

    const token = cookie?.match(/token=([^;]+)/)?.[1]
    const jwt = token && jsonParse(Buffer.from(token.split('.')?.[1], 'base64'))
    const userId = jwt && jwt.role && jwt.aud === 'user' ? jwt.id : ''
    const wafStatus = `${error.action}:${error.terminatingRuleId}`
    const resource = `${error.httpRequest.httpMethod}:/${error.httpRequest.uri
      .split('/')
      .slice(2)
      .join('/')}`
    return {
      exception: exception(`Waf Error:${wafStatus}/${resource}`),
      correlationId: error.requestId,
      ...(userId && { userId }),
      traceId,
      wafStatus,
      resource,
      extra: {
        ...error,
        'x-correlation-log-stream': `${logGroup}/${logStream}`
      }
    }
  }
}

function exception(message, type) {
  const exception = new Error(message)
  exception.stack = ''
  exception.name = type ?? 'Error'
  return exception
}

function logGroupFrom(logGroup) {
  if (logGroup.startsWith('/aws/lambda')) {
    return 'lambda'
  } else if (logGroup.startsWith('/aws/apigateway')) {
    return 'apigateway'
  } else if (logGroup.startsWith('aws-waf-logs-cloudfront')) {
    return 'waf cloudfront'
  } else if (logGroup.startsWith('aws-waf-logs-rest-api')) {
    return 'waf api gateway'
  }
}
