import assert from 'node:assert/strict'
import ms from 'ms'

export default async function assertions(tokens, { abortSignal }) {
  await Promise.all(
    tokens.map(async function userSession(token) {
      const searchParams = new URLSearchParams({
        query: 'query { user { current { id, roles } } }'
      })
      const res = await fetch(
        `${process.env.BASE_URL}/api/graphql?${searchParams.toString()}`,
        {
          headers: {
            Accept: 'application/json; charset=UTF8',
            Cookie: `token=${token.token}`
          },
          signal: abortSignal,
          keepalive: true
        }
      )
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('cache-control'), 'no-cache')
      assert.equal(
        res.headers.get('content-type'),
        'application/json; charset=UTF-8'
      )
      const { data } = await res.json()

      assert.equal(data.user.current.id, token.ref.id)
      assert.ok(Number(token.ref.ttl * 1000) - Date.now() <= ms('12 hours'))
      const roles = data.user.current.roles
      assert.ok(roles.includes('user'))
    })
  )
}
