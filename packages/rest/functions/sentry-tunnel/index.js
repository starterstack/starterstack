import process from 'node:process'
import './http.js'
import ssm from './ssm.js'
import lambdaHandler from './lambda-handler.js'
import ApplicationError from './application-error.js'

export const handler = lambdaHandler(async function sentryTunnel(
  event,
  context,
  { abortSignal, log, bodyParser }
) {
  try {
    const { [`${process.env.SSM_SENTRY_DSN}`]: { value: dsn } = {} } =
      await ssm.get({
        name: process.env.SSM_SENTRY_DSN,
        abortSignal
      })

    if (!dsn) {
      if (process.env.IS_OFFLINE) {
        return {
          status: 400
        }
      }
      throw new ApplicationError('no dsn', { code: 'noDSN' })
    }

    const projectId = dsn.split('/').at(-1)
    const res = await fetch(
      `https://sentry.io/api/${projectId}/envelope/`,
      {
        method: 'POST',
        body: bodyParser
          .text()
          .replaceAll(new RegExp(process.env.SENTRY_REPLACE_DSN, 'gi'), dsn)
      },
      {
        signal: abortSignal,
        keepalive: true
      }
    )

    if (res.status !== 200) {
      throw new Error(
        `failed to fetch, got ${res.status}, error ${await res.text()}`
      )
    }

    return {
      statusCode: 200,
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json; charset=UTF-8'
      },
      body: await res.text()
    }
  } catch (error_) {
    log.error({ event }, error_)
    const statusCode = abortSignal.aborted ? 408 : 400

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
})
