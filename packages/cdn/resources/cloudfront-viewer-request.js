'use strict'

const getSecrets = require('./cloudfront-viewer-request-secrets.js')

module.exports = async function request({
  stackName,
  stackRegion,
  stageRoot,
  stage
}) {
  if (stage === 'local') return ''

  const { anonymousTokenString, apiSecretsString } = await getSecrets({
    stackName,
    stackRegion,
    stage
  })

  return `var crypto = require('crypto')

function handler (event) {
  var request = event.request
  if (!request.headers.host || request.headers.host.value !== '${stageRoot}') {
    return {
      statusCode: 403,
      statusDescription: 'Forbidden'
    }
  }

  if (request.headers.origin) {
    var origin = request.headers.origin.value
    if (origin && origin !== 'https://${stageRoot}' && origin !== 'null' && origin !== 'about:client') {
      return {
        statusCode: 403,
        statusDescription: 'Forbidden'
      }
    }
  }

  if (request.headers.referer && request.method !== 'GET') {
    var referer = request.headers.referer.value
    if (referer && !referer.startsWith('https://${stageRoot}')) {
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

  var searchToken = request.querystring.token && request.querystring.token.value
  if (searchToken) {
    request.cookies.token = { value: searchToken }
  }

  if (
    request.uri.startsWith('/media/~') ||
    request.uri.endsWith('.map') ||
    request.uri.startsWith('/static/js/~/') ||
    request.uri.startsWith('/static/media/~/') ||
    request.uri.startsWith('/static/css/~/')
  ) {
    try {
      verifyJWT(request)
    } catch (err) {
      return {
        statusCode: 403,
        statusDescription: 'Forbidden'
      }
    }
  }


  if (request.uri.startsWith('/api/ws')) {
    request.headers['x-url'] = { value: request.uri }
    request.uri = '/${stage}'
  } else if (request.uri.startsWith('/api')) {
    if (request.uri.startsWith('/api/graphql') && request.method === 'POST') {
      if (request.headers['content-type']) {
        if (request.headers['content-type'].value && request.headers['content-type'].value.split(';')[0] !== 'application/json') {
          return {
            statusCode: 415,
            statusDescription: 'Unsupported Media Type'
          }
        }
      } else {
        request.headers['content-type'] = { value: 'application/json' }
      }
    }
    request.uri = '/${stage}' + '/api-' + request.uri.split('/').slice(2).join('/')
  } else if (!request.uri.includes('.')) {
    request.uri = '/${stage}/ssr' + request.uri
  }

  if (
    request.uri.startsWith('/media') &&
    request.uri.match(/(jpe?g|gif|png)$/) &&
    request.headers.accept &&
    request.headers.accept.value.includes('image/webp') &&
    /\\/x\\d\\//.test(request.uri)
  ) {
    request.uri = request.uri.replace(/(jpe?g|gif|png)$/, 'webp')
  }

  try {
    if (request.cookies.token) {
      resignJWT(request)
    } else {
      request.cookies.token = { value: '${anonymousTokenString}' }
    }
  } catch (err) {
    request.cookies.token = { value: '${anonymousTokenString}' }
  }

  return request
}

function constantTimeEquals(a, b) {
  if (a.length !== b.length) {
    return false
  }
  var xor = 0
  for (var i = 0; i < a.length; i++) {
    xor |= (a.charCodeAt(i) ^ b.charCodeAt(i))
  }
  return 0 === xor
}

function parseJWT (token) {
  var segments = token.split('.')
  if (segments.length !== 3) throw new Error('malformed jwt')
  var signature = segments.slice(-1)[0]
  var payload = JSON.parse(String.bytesFrom(segments[1], 'base64url'))
  if (typeof payload.v === 'undefined') {
    throw new Error('invalid jwt')
  }
  var apiSecrets = ${apiSecretsString}
  var apiSecret = apiSecrets[String(payload.v)]

  if (!apiSecret) {
    throw new Error('no secret found')
  }

  var signed = [apiSecret, 'cf:' + apiSecret].map(secret => {
    return crypto.createHmac('sha256', secret).update(segments.slice(0, -1).join('.')).digest('base64url')
  })

  if (!constantTimeEquals(signature, signed[0]) && !constantTimeEquals(signature, signed[1])) {
    throw new Error('invalid jwt')
  }

  if (typeof payload.nbf !== 'undefined' && Date.now() < payload.nbf * 1000) {
    throw new Error('jwt not active yet')
  }
  if (typeof payload.exp !== 'undefined' && Date.now() > payload.exp * 1000) {
    throw new Error('jwt expired')
  }
  return payload
}

function resignJWT (request) {
  var token = request.cookies.token.value
  var payload = parseJWT(token)
  var parts = token.split('.').slice(0, -1).join('.')
  var apiSecrets = ${apiSecretsString}
  var apiSecret = apiSecrets[String(payload.v)]
  var newSignature = crypto.createHmac('sha256', 'cf:' + apiSecret).update(parts).digest('base64url')
  request.cookies.token.value = parts + '.' + newSignature
}

function verifyJWT (request) {
  if (!request.cookies.token || !request.cookies.token.value) {
    throw new Error('not authorized')
  }

  var payload = parseJWT(request.cookies.token.value)

  var role = Number(payload.role)

  if (!role) {
    throw new Error('not authorized')
  }
  if (request.uri.startsWith('/media/~/user')) {
    if (!request.uri.startsWith('/media/~/user/' + payload.id)) {
      throw new Error('not authorized')
    }
  } else if (request.uri.startsWith('/media/~/role')) {
    var requestedRole = Number(request.uri.split('/')[4])
    if ((role & requestedRole) !== requestedRole) {
      throw new Error('not authorized')
    }
  } else if (request.uri.endsWith('.map')) {
    var superRole = Number(1 << 30)
    if ((role & superRole) !== superRole) {
      throw new Error('not authorized')
    }
  } else if (request.uri.startsWith('/static')) {
    var requestedRole = Number(request.uri.split('/')[4])
    if ((role & requestedRole) !== requestedRole) {
      throw new Error('not authorized')
    }
  } else {
    throw new Error('not authorized')
  }
}

`
}
