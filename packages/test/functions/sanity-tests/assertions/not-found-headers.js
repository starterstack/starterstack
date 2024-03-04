import assert from 'node:assert/strict'
import assertSecurityHeaders from './security-headers.js'

export default async function assertions(_, { abortSignal }) {
  const res = await fetch(`${process.env.BASE_URL}/api/rest/notfound`, {
    signal: abortSignal,
    keepalive: true
  })
  assert.equal(res.status, 403)
  assertSecurityHeaders(res)
}
