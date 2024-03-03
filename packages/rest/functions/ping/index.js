import lambdaHandler from './lambda-handler.js'

// eslint-disable-next-line @typescript-eslint/require-await
export const handler = lambdaHandler(async function ping(event, _, { log }) {
  log.debug({ event }, 'received')
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/plain; charset=UTF-8',
      'Cache-Control': 'no-cache'
    },
    body: `pong@${new Date().toString()}`
  }
})
