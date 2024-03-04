import assert from 'node:assert/strict'
import assertSecurityHeaders from './security-headers.js'

export default async function assertions(_, { abortSignal }) {
  await Promise.all(
    [process.env.BASE_URL, process.env.BASE_URL + '/blank'].map(
      async function testUrl(url) {
        const res = await fetch(url, {
          signal: abortSignal,
          keepalive: true
        })
        if (url === process.env.BASE_URL || url.endsWith('/blank')) {
          assert.equal(res.status, 200)
          const cache = res.headers.get('Cache-Control')
          if (url.endsWith('/blank')) {
            assert.equal(cache, 'no-cache', 'no cache')
          } else {
            assert.ok(cache?.includes('public'), 'public cache')
            assert.ok(
              res.headers.get('Etag')?.startsWith('W/'),
              'has weak etag'
            )
          }
        }
        assertSecurityHeaders(res)
      }
    )
  )
}
