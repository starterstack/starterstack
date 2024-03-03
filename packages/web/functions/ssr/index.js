import process from 'node:process'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import './http.js'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import lambdaHandler from './lambda-handler.js'
import FetchData from './fetch-data.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const buildDirectory = path.join(__dirname, 'build')

const manifest = require(path.join(buildDirectory, 'asset-manifest.json'))

const scriptFiles = Object.keys(manifest.files)
  .map((key) => {
    const value = manifest.files[key]
    return `${buildDirectory}${
      value.startsWith('http') ? new URL(value).pathname : value
    }`
  })
  .filter((key) => key.includes('/static/js/') && key.endsWith('js'))

const scriptContent = scriptFiles
  .map((path) => fs.readFileSync(path, 'utf8'))
  .join('\n')

const htmlIndex = fs.readFileSync(
  path.join(buildDirectory, 'index.html'),
  'utf8'
)

const lastModified = new Date(fs.statSync(buildDirectory).ctime).toGMTString()

const cspMatch = /<meta http-equiv="Content-Security-Policy" content="([^>]+)">/

const csp = htmlIndex.match(cspMatch)[1].replaceAll(/'nonce-[^']+' ?/g, '')

const htmlStripped = htmlIndex
  .replace(cspMatch, '')
  .replace(
    '<noscript>You need to enable JavaScript to run this app.</noscript>',
    ''
  )
  .replaceAll(/nonce="[^"]*"/g, '')

const createFetch = ({ userAgent, tokenCookie, abortSignal }) =>
  async function wrapFetch(url, options) {
    options = { ...options }
    const omit = options.credentials && options.credentials === 'omit'
    if (!options.headers) options.headers = {}
    if (!omit && tokenCookie) {
      options.headers.cookie = tokenCookie
    }
    if (userAgent) {
      options.headers['user-agent'] = userAgent
    }
    return await fetch(url, {
      ...options,
      signal: abortSignal,
      keepalive: true
    })
  }

export const handler = lambdaHandler(async function serverlessSideRendering(
  event,
  context,
  { log, abortSignal }
) {
  log.debug({ event }, 'received')

  try {
    let url = event?.path?.replace(/^\/ssr/, '') || '/'

    if (url.includes('.')) {
      return {
        statusCode: 403,
        headers: {
          'Cache-Control': 'no-cache'
        }
      }
    }

    if (url.startsWith('/api/')) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'text/html; charset=UTF-8',
          'Content-Security-Policy': csp,
          'Cache-Control': 'no-cache'
        },
        body: `<meta name="viewport" content="width=device-width,initial-scale=1">
      <h4>Sorry ${url} wasn't found 😞</h4>
      `
      }
    }

    if (event.multiValueQueryStringParameters) {
      const search = new URLSearchParams(
        event.multiValueQueryStringParameters
      ).toString()
      if (search) {
        url += '?' + search
      }
    }

    if (url === '/blank') {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/html; charset=UTF-8',
          'Content-Security-Policy': csp,
          'Cache-Control': 'no-cache'
        },
        body: htmlStripped
      }
    }

    const headers = Object.entries(event.headers).reduce(
      (sum, [key, value]) => {
        sum[key.toLowerCase()] = value
        return sum
      },
      {}
    )

    const userAgent = headers['user-agent']

    const tokenCookie = Object.entries(event.multiValueHeaders || {})
      ?.find(([key]) => key.toLowerCase() === 'cookie')?.[1]
      ?.find((cookie) => cookie?.startsWith('token='))

    const start = Date.now()
    const script = new vm.Script(scriptContent)
    const urlLinks = {}
    const getSSR = new Promise((resolve, reject) => {
      abortSignal.addEventListener(
        'abort',
        () => reject(new Error('timeout')),
        { once: true }
      )
      let pageUrl = 'default'
      const notSetTimer = setTimeout(
        () => reject(new Error('setVMSSRFunction not called')),
        100
      )
      const emptySelf = {}

      try {
        script.runInNewContext({
          Buffer,
          clearImmediate,
          clearInterval,
          clearTimeout,
          console,
          queueMicrotask,
          exports: undefined,
          global: undefined,
          module: undefined,
          process: undefined,
          require: undefined,
          import: undefined,
          window: undefined,
          self: new Proxy(emptySelf, {
            get(obj, prop) {
              return obj[prop]
            },
            set(obj, prop, value) {
              obj[prop] = value
              return obj
            }
          }),
          setImmediate,
          setInterval,
          setTimeout,
          TextDecoder,
          TextEncoder,
          URL,
          URLSearchParams,
          WebAssembly,
          setVMSSRFunction: (f) => {
            clearTimeout(notSetTimer)
            resolve((state) => {
              pageUrl = state.url
              return f(state)
            })
          },
          document: {
            getElementsByTagName() {
              return [{ appendChild() {}, getAttribute() {} }]
            },
            head: {
              appendChild() {
                return {}
              }
            },
            createElement() {
              return new Proxy(
                {},
                {
                  get(obj, prop) {
                    if (prop === 'parentNode') {
                      return {
                        removeChild() {}
                      }
                    } else if (prop === 'setAttribute') {
                      return function setAttribute(name, value) {
                        obj[name] = value
                      }
                    }
                  },
                  set(obj, prop, value) {
                    obj[prop] = value
                    if (
                      prop === 'onload' &&
                      value &&
                      typeof value === 'function'
                    ) {
                      process.nextTick(() => {
                        if (obj.type === 'text/css') {
                          if (!urlLinks[pageUrl]) {
                            urlLinks[pageUrl] = []
                          }
                          const links = urlLinks[pageUrl]
                          const attributes = []
                          for (const [key, value] of Object.entries(obj)) {
                            if (
                              key === 'timeout' ||
                              typeof value === 'function'
                            ) {
                              continue
                            }
                            const prefix =
                              key === 'href' ? process.env.PUBLIC_URL || '' : ''
                            attributes.push(`${key}="${prefix}${value}"`)
                          }
                          links.push(`<link ${attributes.join(' ')}>`)
                        }
                        value({ type: 'load' })
                      })
                    }
                    return {}
                  }
                }
              )
            }
          }
        })
      } catch (error) {
        clearTimeout(notSetTimer)
        reject(error)
      }
    })

    const urlPrefix = process.env.IS_OFFLINE
      ? 'http://127.0.0.1:5001'
      : process.env.STAGE_ORIGIN

    const fetchData = FetchData(
      urlPrefix,
      createFetch({ tokenCookie, userAgent, abortSignal }),
      crypto
    )

    const [ssr, state] = await Promise.all([getSSR, fetchData(url)])

    const stateString = `window.__INJECT_STATE__=${JSON.stringify(
      state
    ).replaceAll('<', '\\u003c')}`

    const stateHash = `sha256-${crypto
      .createHash('sha256')
      .update(stateString)
      .digest('base64')}`

    const etag = `W/"${stateHash}"`

    const cacheControl = state.cache || 'max-age=0, s-maxage=600'

    const cache = !/no-cache|max-age=0/.test(cacheControl)

    if (
      cache &&
      headers['if-modified-since'] <= lastModified &&
      headers['if-none-match'] === etag
    ) {
      return {
        statusCode: 304,
        headers: {
          'Content-Security-Policy': csp.replace(
            /(script-src 'self' )/,
            `$1 '${stateHash}' `
          ),
          ETag: etag,
          'Cache-Control': cacheControl,
          'Last-Modified': lastModified,
          'Server-Timing': `not-mod;dur=${Date.now() - start}`
        }
      }
    }

    const stateScript = `<script>${stateString}</script>`

    const { html, style = '' } = await ssr(state)

    // wait for css
    await new Promise((resolve) => process.nextTick(resolve))

    // default css and any url specific chunks
    const links = [
      ...new Set([...(urlLinks.default ?? []), urlLinks[url] ?? []])
    ]

    const redirectUrl = state[Symbol.for('redirect')]
    const refresh = state[Symbol.for('refresh')]
    const refreshTag = refresh
      ? `<meta http-equiv="refresh" content="${refresh}">`
      : ''

    return {
      statusCode: redirectUrl ? 302 : 200,
      headers: {
        ...(redirectUrl && {
          Location: redirectUrl
        }),
        'Content-Type': 'text/html; charset=UTF-8',
        'Content-Security-Policy': csp.replace(
          /(script-src 'self' )/,
          `$1 '${stateHash}' `
        ),
        ETag: etag,
        'Last-Modified': lastModified,
        'Cache-Control': cacheControl,
        'Server-Timing': `ssr;dur=${Date.now() - start}`
      },
      ...(!redirectUrl && {
        body: htmlStripped
          .replace(
            /(<\/head>)/,
            `${refreshTag}${links.join('')}${style}${stateScript}$1`
          )
          .replace(/(<main id="root">)(<\/main>)/, `$1${html}$2`)
      })
    }
  } catch (error) {
    log.error({ event }, error)
    return {
      statusCode: abortSignal.aborted ? 408 : 500,
      headers: {
        'Content-Security-Policy': csp,
        'Cache-Control': 'no-cache'
      }
    }
  }
})
