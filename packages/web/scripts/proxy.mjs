import path from 'node:path'
import mime from 'mime'
import fs from 'fs/promises'
import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import verifyJWT from './verify-jwt.mjs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const setupProxy = require('./http-middleware.js')
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default function proxy() {
  const app = express()

  setupProxy(app)

  app.get('*.*', async function serveStatic(req, res) {
    try {
      const { pathname: url } = new URL(req.url, 'http://x')

      if (
        url.endsWith('.map') ||
        url.startsWith('/static/js/~/') ||
        url.startsWith('/static/media/~/') ||
        url.startsWith('/static/css/~/')
      ) {
        const notAuthorized = function notAuthorized() {
          console.log(`${url} not authorized`)
          res.writeHead(401)
          res.end()
        }
        const tokenData = await verifyJWT(req)

        if (!tokenData) return notAuthorized()
        const role = Number(tokenData.role)

        if (url.endsWith('.map')) {
          const superRole = Number(1 << 30)
          const role = Number(tokenData.role)
          if ((role & superRole) !== superRole) {
            return notAuthorized()
          }
        }

        if (url.startsWith('/static') && url.includes('/~/')) {
          const requestedRole = Number(url.split('/')[4])
          if ((role & requestedRole) !== requestedRole) {
            return notAuthorized()
          }
        }
      }

      const assetPath = path.join(__dirname, '..', 'build', url.slice(1))
      if (!(await fs.stat(assetPath).catch((_) => false))) {
        res.writeHead(404)
        res.end()
        return
      }
      const content = await fs.readFile(assetPath)
      res.writeHead(200, {
        'Content-Type': mime.getType(url),
        'Cache-Control': getCacheControl(url)
      })
      res.end(content)
    } catch (err) {
      console.error(err)
      if (!res.headersSent) {
        res.writeHead(500)
        res.end()
      }
    }
  })

  app.get(
    '*',
    createProxyMiddleware({
      target: 'http://localhost:2999/local',
      pathRewrite: { '^/': '/ssr/' },
      changeOrigin: true,
      onProxyRes: function onProxyRes(proxyRes, req, res) {
        if (
          req.headers.host &&
          req.headers.host.match(/^([0-9.]+|localhost):3000/)
        ) {
          const csp = proxyRes.headers['content-security-policy']
          if (csp) {
            proxyRes.headers['content-security-policy'] = csp.replace(
              'upgrade-insecure-requests',
              ''
            )
          }
        }
      }
    })
  )

  app.listen(3000)
}

function getCacheControl(url) {
  if (url.startsWith('/static')) {
    return 'must_revalidate, public, max-age=31536000'
  } else if (url === '/service-worker.js') {
    return 'no-cache'
  } else {
    return 'max-age=0, s-maxage=600'
  }
}
