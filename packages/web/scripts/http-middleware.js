// eslint-disable-next-line
'use strict'

const { Buffer } = require('node:buffer')
const { createProxyMiddleware } = require('http-proxy-middleware')
const {
  HeadObjectCommand,
  GetObjectCommand,
  NotFound
} = require('@aws-sdk/client-s3')

module.exports = function setupProxy(app) {
  try {
    app.use(
      createProxyMiddleware(
        function filter(pathname, req) {
          return pathname.startsWith('/api/ws')
        },
        {
          target: 'http://localhost:5003',
          changeOrigin: true,
          pathRewrite(path, req) {
            const [url, search] = req.url.split('?')
            req.headers['x-url'] = url
            return search ? `?${search}` : ''
          },
          ws: true,
          onProxyReqWs(proxyReq, req, socket) {
            socket.on('error', (err) => console.warn('websocket error', err))
          }
        }
      )
    )
    app.use(
      createProxyMiddleware(
        function filter(pathname, req) {
          return pathname.startsWith('/api/rest')
        },
        {
          target: 'http://localhost:3001/local',
          pathRewrite: {
            '^/api/rest': '/api-rest'
          },
          onProxyRes(proxyRes, req, res) {
            if (proxyRes.headers['set-cookie']) {
              const setCookie = proxyRes.headers['set-cookie']
              const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
              proxyRes.headers['set-cookie'] = cookies.map((cookie) =>
                cookie.replace(/\s*Secure;\s*/g, '')
              )
            }
          }
        }
      )
    )
    app.use(
      createProxyMiddleware(
        function filter(pathname, req) {
          return pathname.startsWith('/api/graphql')
        },
        {
          target: 'http://localhost:3002/local',
          pathRewrite: {
            '^/api/graphql': '/api-graphql'
          }
        }
      )
    )
    app.get('/media/*', serveMedia)
    app.post(
      '/media',
      createProxyMiddleware({
        target: 'http://localhost:4569',
        changeOrigin: true
      })
    )
  } catch (error) {
    console.error('Error trying to proxy request on dev client:  ', error)
  }

  return { serveMedia }

  async function serveMedia(req, res) {
    const { default: mime } = await import('mime')
    const { url } = req
    const { default: s3 } = await import('../../shared/s3.js')

    if (url.startsWith('/media/~')) {
      const forbidden = function forbidden() {
        res.writeHead(403)
        res.end()
      }

      const { default: verifyJWT } = await import('./verify-jwt.mjs')
      const tokenData = await verifyJWT(req)

      if (!tokenData) return forbidden()
      if (url.startsWith('/media/~/user')) {
        if (!url.startsWith('/media/~/user/' + tokenData.id)) {
          return forbidden()
        }
      } else if (url.startsWith('/media/~/role')) {
        const requestedRole = Number(url.split('/')[4])
        const role = Number(tokenData.role)

        if ((role & requestedRole) !== requestedRole) {
          return forbidden()
        }
      } else {
        return forbidden()
      }
    }

    const key = url.includes('.')
      ? decodeURIComponent(url.slice(1))
      : url === '/blank'
        ? 'blank.html'
        : 'index.html'

    const params = {
      Bucket: 'media',
      Key: key
    }

    try {
      const {
        ETag,
        LastModified,
        ContentLength,
        CacheControl,
        ContentType,
        Metadata
      } = await s3.send(new HeadObjectCommand(params))

      res.writeHead(200, {
        'content-type':
          ContentType === 'application/octet-stream'
            ? mime.getType(url) || 'application/octet-stream'
            : ContentType,
        'content-length': ContentLength,
        'last-modified': LastModified,
        ...(Metadata?.csp && {
          'content-security-policy': getCsp({
            csp: Metadata.csp,
            host: req.headers.host
          })
        }),
        etag: ETag,
        ...(CacheControl && { 'cache-control': CacheControl })
      })

      const { Body: s3Stream } = await s3.send(new GetObjectCommand(params))

      for await (const chunk of s3Stream) {
        res.write(chunk)
      }
      res.end()
    } catch (err) {
      if (err instanceof NotFound) {
        res.writeHead(404)
        res.end()
      } else {
        console.error(err)
        if (!res.headersSent) {
          res.writeHead(500)
        }
        res.end()
      }
    }
  }
}

function getCsp({ csp, host }) {
  if (csp.startsWith('=?utf-8?b?')) {
    csp = Buffer.from(csp.slice(10, -2), 'base64').toString()
  }

  if (host && host.match(/^([0-9.]+|localhost|127\.0\.0\.1):3000/)) {
    return csp.replace('upgrade-insecure-requests', '')
  } else {
    return csp
  }
}
