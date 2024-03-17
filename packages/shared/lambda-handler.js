// @ts-check
import process from 'node:process'
import { Buffer } from 'node:buffer'

const LOG_SAMPLE_RATE = 0.05

const CORRELATION_PREFIX = 'x-correlation-'

/**
 * @typedef {import('aws-lambda').Context} Context
 * @typedef {{
 *   message: string,
 *   stack: string,
 *   constructor: {
 *     name: string
 *   }
 * } | unknown} ErrorLike
 * @typedef {any} Event
 * @typedef {{[key: string]: string | number | boolean}} CorrelationMap
 * @typedef {function(CorrelationMap): void} ReplaceCorrelationIds
 * @typedef {string | object | ErrorLike} LogParameter
 * @typedef {function(LogParameter, LogParameter=): void} LogFunction
 * @typedef {{
 *   info: LogFunction,
 *   debug: LogFunction,
 *   warn: LogFunction,
 *   error: LogFunction
 * }} Log
 * @typedef {{
 *   json: function(): object,
 *   form: function(): object,
 *   text: function(): string
 * }} BodyParser
 * @typedef {function(): {[key: string]: string}} HeaderParser
 * @typedef {function(String): any} JSONParse
 * @typedef {function(Event, Context, {
 *   log: Log,
 *   abortSignal: AbortSignal,
 *   correlationIds: CorrelationMap,
 *   replaceCorrelationIds: ReplaceCorrelationIds
 *   bodyParser: BodyParser,
 *   headerParser: HeaderParser
 *   jsonParse: JSONParse
 * }): Promise<any>} Handler
 */

const Prefix = {
  debugLogEnabled: `${CORRELATION_PREFIX}debug-log-enabled`,
  correlationPrefix: CORRELATION_PREFIX,
  awsRequestId: `${CORRELATION_PREFIX}id`,
  apiRequestId: `${CORRELATION_PREFIX}api-id`,
  xrayTraceId: `${CORRELATION_PREFIX}trace-id`,
  userId: `${CORRELATION_PREFIX}user-id`,
  lambda: `${CORRELATION_PREFIX}lambda`,
  callChain: `${CORRELATION_PREFIX}call-chain-length`,
  gitCommit: `${CORRELATION_PREFIX}git-commit`,
  logStream: `${CORRELATION_PREFIX}log-stream`
}

export const prefix = Prefix

const logLevels = {
  labels: {
    20: 'debug',
    30: 'info',
    40: 'warn',
    50: 'error'
  },
  values: { debug: 20, info: 30, warn: 40, error: 50 }
}

/**
 * @param {Handler} handler
 * @returns {function(Event, Context): Promise<any>}
 *
 */

export default function wrapHandler(handler) {
  return async function lambdaHandler(event, context) {
    // @ts-ignore yes there is a timeout property...
    const abortSignal = AbortSignal.timeout(
      Math.floor(
        event?.context?.getRemainingTimeInMillis
          ? Math.min(
              event.context.getRemainingTimeInMillis,
              context.getRemainingTimeInMillis() - 50
            )
          : context.getRemainingTimeInMillis() - 50
      )
    )

    /** @type {CorrelationMap} */
    const correlationIds = getCorrelationIds(event, context)

    /** @type {ReplaceCorrelationIds} */
    const replaceCorrelationIds = getReplaceCorrelationIds(
      event,
      context,
      correlationIds
    )

    /* eslint-disable no-undef */
    // @ts-ignore
    globalThis[Symbol.for('correlationIds')] = correlationIds
    /* eslint-enable no-undef */

    /** @type {Log} */
    const log = createLogger(correlationIds)

    /** @type {BodyParser} */
    const bodyParser = getBodyParser(event)

    /** @type {HeaderParser} */
    const headerParser = getHeaderParser(event)

    /** @type {any} */
    const result = /** @type {Handler} */ await handler(event, context, {
      abortSignal,
      correlationIds,
      replaceCorrelationIds,
      log,
      bodyParser,
      headerParser,
      jsonParse
    })

    return result
  }
}

/**
 * @param {Event} event
 * @param {Context} context
 * @param {CorrelationMap} correlationIds
 * @returns {ReplaceCorrelationIds}
 */
function getReplaceCorrelationIds(event, context, correlationIds) {
  return function replaceCorrelationIds(payload) {
    for (const key of Object.keys(correlationIds)) {
      delete correlationIds[key]
    }

    Object.assign(
      correlationIds,
      getCorrelationIds(
        event,
        context,
        Object.entries(payload).reduce(
          /** @param {CorrelationMap} sum */
          (sum, [k, v]) => {
            sum[
              k.startsWith(String(prefix.correlationPrefix))
                ? k
                : `${String(prefix.correlationPrefix)}${k}`
            ] = v
            return sum
          },
          {}
        )
      )
    )
  }
}

/**
 * @param {{
 *   headers: {[key: string]: string} | undefined,
 * }} options header parser options
 * @returns {HeaderParser}
 */
function getHeaderParser({ headers }) {
  return function headerParser() {
    return Object.entries(headers ?? {}).reduce(
      /** @param {{[key: string]: string}} sum */
      (sum, [key, value]) => {
        sum[key.toLowerCase()] = value
        return sum
      },
      {}
    )
  }
}

/**
 * @param {Event} event
 * @param {Context} context
 * @param {CorrelationMap} [replacePayload]
 * @returns {CorrelationMap}
 */

function getCorrelationIds(event, context, replacePayload) {
  const { id: userId } =
    event.requestContext?.authorizer?.lambda ??
    event.requestContext?.authorizer ??
    {}
  const lambdaFunctionName = context.functionName
  const awsRequestId = context.awsRequestId
  const apiRequestId = event.requestContext?.requestId
  const xrayTraceId = process.env._X_AMZN_TRACE_ID
  const gitCommit = process.env.GIT_COMMIT
  const logStream = `${context.logGroupName}/${context.logStreamName}`
  const payload =
    replacePayload ??
    event?.detail?.correlationIds ??
    event?.correlationIds ??
    event
  const debugLogEnabled =
    process.env.LOG_DEBUG ??
    payload[prefix.debugLogEnabled] ??
    Math.random() <= LOG_SAMPLE_RATE

  const correlationIds = {
    ...Object.keys(payload)
      .filter((key) => key?.startsWith(prefix.correlationPrefix))
      .reduce(
        (sum, key) => {
          sum[key] = payload[key]
          return sum
        },
        {
          [prefix.awsRequestId]: awsRequestId,
          [prefix.apiRequestId]: apiRequestId,
          [prefix.xrayTraceId]: xrayTraceId,
          [prefix.userId]: userId
        }
      ),
    [prefix.callChain]: Number(payload[prefix.callChain] ?? 0) + 1,
    [prefix.debugLogEnabled]: Boolean(debugLogEnabled),
    [prefix.lambda]: lambdaFunctionName,
    [prefix.gitCommit]: gitCommit,
    [prefix.logStream]: logStream
  }

  if (correlationIds[prefix.callChain] === 10) {
    const infiniteError = new Error(
      'Possible infinite recursion detected, invocation is stopped.'
    )
    const log = createLogger(correlationIds)
    log.error({ event }, infiniteError)
    throw infiniteError
  }
  return correlationIds
}

/**
 * @param {{
 *   body: string | undefined,
 *   isBase64Encoded: boolean | undefined
 * }} options body parser options
 * @returns {BodyParser}
 */
function getBodyParser(
  { body, isBase64Encoded } = { body: undefined, isBase64Encoded: false }
) {
  if (body && typeof body === 'object') {
    return {
      json() {
        return body
      },
      form() {
        throw new Error('not available as event.body was an object')
      },
      text() {
        return JSON.stringify(body)
      }
    }
  } else {
    const bodyData = Buffer.from(
      body || '',
      isBase64Encoded ? 'base64' : undefined
    ).toString()
    return {
      json() {
        return jsonParse(bodyData)
      },
      form() {
        return new URLSearchParams(bodyData)
      },
      text() {
        return bodyData
      }
    }
  }
}

/** @type JSONParse */
function jsonParse(text) {
  return JSON.parse(text, function stripProto(key, value) {
    if (key === '__proto__' || key === 'constructor') {
      throw new Error(`${key} prototype pollution detected`)
    } else {
      return value
    }
  })
}

/**
 * @param {CorrelationMap} correlationIds
 * @returns {Log}
 */

function createLogger(correlationIds) {
  const awsRequestId = correlationIds?.[prefix.awsRequestId]
  const apiRequestId = correlationIds?.[prefix.apiRequestId]

  /** @type function('error' | 'warn' | 'info' | 'debug'): LogFunction **/
  function format(logLevelLabel) {
    const logLevel = correlationIds[prefix.debugLogEnabled]
      ? logLevels.values.debug
      : Number(process.env.LOG_LEVEL ?? logLevels.values.warn)

    const level = logLevels.values[logLevelLabel]

    if (level < logLevel) {
      return function skipLog() {}
    }

    /** @type {LogFunction} */
    return function log(messageOrData, message) {
      const now = Date.now()

      /** @type {any} */
      const data =
        typeof messageOrData === 'object' && !isError(messageOrData)
          ? {
              ...messageOrData,
              .../** @type {object} */
              (
                message &&
                  (isError(message)
                    ? {
                        ...serializeError(message)
                      }
                    : { msg: message })
              )
            }
          : {
              ...(isError(messageOrData)
                ? {
                    ...serializeError(messageOrData)
                  }
                : {
                    msg: messageOrData
                  })
            }

      const msg = data.msg || data.err?.message

      const logMessage = {
        ...(msg && { msg }),
        awsRequestId,
        apiRequestId,
        ...correlationIds,
        level: logLevelLabel,
        time: now,
        ...data
      }

      const writeStream =
        process[logLevelLabel === 'error' ? 'stderr' : 'stdout']
      writeStream.write(JSON.stringify(logMessage) + '\n')
    }
  }

  return {
    info: format('info'),
    error: format('error'),
    warn: format('warn'),
    debug: format('debug')
  }
}

/**
 * @param {any} err
 * @returns Boolean
 **/
function isError(err) {
  return !!(err?.stack && err?.message && err?.constructor?.name)
}

/**
 * @param {any} err
 * @returns {{type: string, msg: string, stack: string | undefined, extensions: any | undefined}} options
 **/
function serializeError(err) {
  return {
    type: err.constructor.name,
    msg: err.message,
    stack: err.stack,
    extensions: err.extensions
  }
}
