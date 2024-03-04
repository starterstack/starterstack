import assert from 'node:assert/strict'

export default function assertions(res) {
  assert.equal(res.headers.get('Server'), '', 'no server')
  assert.ok(
    res.headers.get('Content-Security-Policy'),
    'has content security policy'
  )
  assert.equal(
    res.headers.get('Cross-Origin-Opener-Policy'),
    'same-origin',
    'cross origin opener policy'
  )
  assert.equal(
    res.headers.get('Cross-Origin-Resource-Policy'),
    'same-origin',
    'cross origin resource policy'
  )
  assert.equal(
    res.headers.get('Strict-Transport-Security'),
    'max-age=15768000; includeSubDomains; preload',
    'strict transport security'
  )
  assert.equal(
    res.headers.get('X-Content-Type-Options'),
    'nosniff',
    'content type options'
  )
  assert.equal(
    res.headers.get('X-Dns-Prefetch-Control'),
    'off',
    'dns prefetch control'
  )
  assert.equal(
    res.headers.get('X-Download-Options'),
    'noopen',
    'download options'
  )
  assert.equal(res.headers.get('X-Frame-Options'), 'DENY', 'frame options')
  assert.equal(
    res.headers.get('X-Permitted-Cross-Domain-Policies'),
    'none',
    'permitted cross domain policies'
  )
  assert.equal(
    res.headers.get('X-Xss-Protection'),
    '1; mode=block',
    'xss protection'
  )
}
