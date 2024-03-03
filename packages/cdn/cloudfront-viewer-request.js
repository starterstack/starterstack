// eslint-disable-next-line unicorn/prefer-node-protocol
import crypto from 'crypto'
import cf from 'cloudfront'

const stageRoot = '${StageRoot}'
const stage = '${Stage}'
const origin = '${StageRootUrl}'
const kv = cf.kvs('${CloudFrontKeyValueStore}')

let config = {}

// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
async function handler(event) {
  const request = event.request

  if (!request.headers.host || request.headers.host.value !== stageRoot) {
    return {
      statusCode: 403,
      statusDescription: 'Forbidden'
    }
  }

  if (request.headers.origin) {
    const requestOrigin = request.headers.origin.value
    if (
      requestOrigin &&
      requestOrigin !== origin &&
      requestOrigin !== 'null' &&
      requestOrigin !== 'about:client'
    ) {
      return {
        statusCode: 403,
        statusDescription: 'Forbidden'
      }
    }
  }

  if (request.headers.referer && request.method !== 'GET') {
    const referer = request.headers.referer.value
    if (referer && !referer.startsWith(origin)) {
      return {
        statusCode: 403,
        statusDescription: 'Forbidden'
      }
    }
  }

  request.headers['x-now'] = { value: Date.now() + '' }

  if (request.headers['x-api']) {
    delete request.headers['x-api']
  }

  const searchToken =
    request.querystring.token && request.querystring.token.value

  if (searchToken) {
    request.cookies.token = { value: searchToken }
  }

  config = await kv.get('config', { format: 'json' })

  if (
    request.uri.startsWith('/media/~') ||
    request.uri.endsWith('.map') ||
    request.uri.startsWith('/static/js/~/') ||
    request.uri.startsWith('/static/media/~/') ||
    request.uri.startsWith('/static/css/~/')
  ) {
    try {
      verifyJWT(request)
    } catch (_) {
      return {
        statusCode: 403,
        statusDescription: 'Forbidden'
      }
    }
  }

  if (request.uri.startsWith('/api/ws')) {
    request.headers['x-url'] = { value: request.uri }
    request.uri = '/' + stage
  } else if (request.uri.startsWith('/api')) {
    if (request.uri.startsWith('/api/graphql') && request.method === 'POST') {
      if (request.headers['content-type']) {
        if (
          request.headers['content-type'].value &&
          request.headers['content-type'].value.split(';')[0] !==
            'application/json'
        ) {
          return {
            statusCode: 415,
            statusDescription: 'Unsupported Media Type'
          }
        }
      } else {
        request.headers['content-type'] = { value: 'application/json' }
      }
    }
    request.uri = '/' + stage + request.uri
  } else if (!request.uri.includes('.')) {
    request.uri = '/' + stage + request.uri
  }

  if (
    request.uri.startsWith('/media') &&
    /(jpe?g|gif|png)$/.test(request.uri) &&
    request.headers.accept &&
    request.headers.accept.value.includes('image/webp') &&
    /\/x\d\//.test(request.uri)
  ) {
    request.uri = request.uri.replace(/(jpe?g|gif|png)$/, 'webp')
  }

  try {
    if (request.cookies.token) {
      resignJWT(request)
    } else {
      request.cookies.token = { value: config.anonymousTokenString }
    }
  } catch (_) {
    request.cookies.token = { value: config.anonymousTokenString }
  }

  return request
}

function constantTimeEquals(a, b) {
  if (a.length !== b.length) {
    return false
  }
  let xor = 0
  for (let i = 0; i < a.length; i++) {
    xor |= a.codePointAt(i) ^ b.codePointAt(i)
  }
  return 0 === xor
}

function parseJWT(token) {
  const segments = token.split('.')
  if (segments.length !== 3) throw new Error('malformed jwt')
  const signature = segments.slice(-1)[0]
  const payload = JSON.parse(Buffer.from(segments[1], 'base64url'))
  if (payload.v === undefined) {
    throw new TypeError('invalid jwt')
  }
  const apiSecrets = config.apiSecrets
  const apiSecret = apiSecrets[String(payload.v)]

  if (!apiSecret) {
    throw new Error('no secret found')
  }

  const signed = [apiSecret, 'cf:' + apiSecret].map((secret) => {
    return crypto
      .createHmac('sha256', secret)
      .update(segments.slice(0, -1).join('.'))
      .digest('base64url')
  })

  if (
    !constantTimeEquals(signature, signed[0]) &&
    !constantTimeEquals(signature, signed[1])
  ) {
    throw new Error('invalid jwt')
  }

  if (payload.nbf !== undefined && Date.now() < payload.nbf * 1000) {
    throw new Error('jwt not active yet')
  }
  if (payload.exp !== undefined && Date.now() > payload.exp * 1000) {
    throw new Error('jwt expired')
  }
  return payload
}

function resignJWT(request) {
  const token = request.cookies.token.value
  const payload = parseJWT(token)
  const parts = token.split('.').slice(0, -1).join('.')
  const apiSecrets = config.apiSecrets
  const apiSecret = apiSecrets[String(payload.v)]
  const newSignature = crypto
    .createHmac('sha256', 'cf:' + apiSecret)
    .update(parts)
    .digest('base64url')
  request.cookies.token.value = parts + '.' + newSignature
}

function verifyJWT(request) {
  if (!request.cookies.token || !request.cookies.token.value) {
    throw new Error('not authorized')
  }

  const payload = parseJWT(request.cookies.token.value)

  const role = Number(payload.role)

  if (!role) {
    throw new Error('not authorized')
  }
  if (request.uri.startsWith('/media/~/user')) {
    if (!request.uri.startsWith('/media/~/user/' + payload.id)) {
      throw new Error('not authorized')
    }
  } else if (request.uri.startsWith('/media/~/role')) {
    const requestedRole = Number(request.uri.split('/')[4])
    if ((role & requestedRole) !== requestedRole) {
      throw new Error('not authorized')
    }
  } else if (request.uri.endsWith('.map')) {
    const superRole = Number(1 << 30)
    if ((role & superRole) !== superRole) {
      throw new Error('not authorized')
    }
  } else if (request.uri.startsWith('/static')) {
    const requestedRole = Number(request.uri.split('/')[4])
    if ((role & requestedRole) !== requestedRole) {
      throw new Error('not authorized')
    }
  } else {
    throw new Error('not authorized')
  }
}
