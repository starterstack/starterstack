import process from 'node:process'
import './http.js'
import lambdaHandler from './lambda-handler.js'

export const handler = lambdaHandler(async function logout(
  event,
  _context,
  { abortSignal }
) {
  const res = await fetch(`${process.env.BASE_URL}/api/rest/logout`, {
    signal: abortSignal,
    keepalive: true,
    redirect: 'manual',
    headers: {
      cookie: `token=${event.token}`
    },
    method: 'POST'
  })
  if (res.status !== 301) {
    throw new Error(`failed to fetch: ${res.status}`)
  }
  return {
    ttl: event.ttl
  }
})
