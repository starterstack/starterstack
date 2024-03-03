/* eslint-env serviceworker */
/* eslint-disable no-restricted-globals */

const cacheKey = 'static'

self.addEventListener('error', onerror)
self.addEventListener('message', onmessage)
self.addEventListener('install', oninstall)
self.addEventListener('fetch', onfetch)
self.addEventListener('notificationclick', onnotificationclick)
self.addEventListener('activate', onactivate)

async function cacheBlank() {
  try {
    const cache = await self.caches.open(cacheKey)
    const current = await cache.match('/blank')
    const res = await self.fetch('/blank', {
      method: 'GET',
      headers: {
        pragma: 'no-cache',
        'cache-control': 'no-cache'
      },
      credentials: 'omit'
    })
    if (res.status === 200) {
      await cache.put('/blank', res.clone())
      if (current && (await res.text()) !== (await current.text())) {
        postMessage({ action: 'refresh' })
      }
    }
  } catch (err) {
    reportError(err)
  }
}

function reportError(error) {
  try {
    postMessage({
      action: 'error',
      error: error.toString()
    })
  } catch (err) {
    console.error(err)
  }
}

function onerror(error) {
  postMessage({
    action: 'error',
    error: error.toString()
  })
}

function onmessage(event) {
  if (event.data.action === 'refresh') {
    cacheBlank()
  }
}

async function install() {
  await cacheBlank()
  await self.skipWaiting()
}

function oninstall(event) {
  event.waitUntil(install())
}

function onfetch(event) {
  if (event.request.method !== 'GET') return
  if (
    event.request.cache === 'only-if-cached' &&
    event.request.mode !== 'same-origin'
  ) {
    return
  }

  const url = new self.URL(event.request.url)

  if (
    url.origin === self.location.origin &&
    event.request.referrer &&
    new self.URL(event.request.referrer).origin !== self.location.origin
  ) {
    return
  }

  if (url.origin !== self.location.origin) {
    return
  }

  const html = event.request.headers.get('accept').match(/text\/html/)

  const cacheAsset = async () => {
    try {
      const res = await self.fetch(event.request, { cache: 'no-cache' })
      if (res.status >= 200 && res.status <= 299) {
        const shouldCache =
          res.headers.has('Cache-Control') &&
          !/private|no-cache|no-store|max-age=0/.test(
            res.headers.get('Cache-Control')
          )
        if (shouldCache) {
          console.warn(`no cache hit for ${url.pathname}`)
          const cache = await self.caches.open(cacheKey)
          await cache.put(event.request, res.clone())
        }
      }
      return res
    } catch (err) {
      reportError(err)
    }
  }

  const passthrough = async () => {
    return await self.fetch(event.request)
  }

  const nohit = async () => {
    if (url.origin === self.location.origin && !html) {
      try {
        return await cacheAsset(url)
      } catch (err) {
        console.warn(`error caching ${url.pathname}`, err)
        return await passthrough()
      }
    } else {
      return await passthrough()
    }
  }

  if (url.search) return

  const rtt =
    typeof self.navigator.connection !== 'undefined' &&
    self.navigator.connection.rtt

  const offline =
    typeof self.navigator.onLine !== 'undefined' && !self.navigator.onLine

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

  const serveBlank =
    url.origin === self.location.origin &&
    !isMobile &&
    !url.pathname.startsWith('/api') &&
    !url.pathname.startsWith('/media') &&
    html &&
    (rtt < 200 || offline)

  if (
    !serveBlank &&
    !/^\/(static|favicon|logo|manifest.json|service-worker.js)/.test(
      url.pathname
    )
  ) {
    return
  }

  const getResponse = async () => {
    try {
      const cache = await self.caches.open(cacheKey)
      const res = await cache.match(event.request.url)
      if (res && res.headers.has('Cache-Control')) {
        if (offline) return res
        const created = new Date(res.headers.get('Date') || 0).getTime()
        const ttl =
          1000 *
          Number(
            (res.headers.get('Cache-Control').match(/max-age=([\d]+)/) || [
              0, 0
            ])[1]
          )
        const expires = created + ttl
        if (expires > Date.now()) {
          return res
        }
      }
      if (serveBlank) {
        const blank = await cache.match('/blank')
        if (blank) return blank
      }
      return await nohit()
    } catch (err) {
      reportError(err)
    }
    return await passthrough()
  }

  event.respondWith(getResponse())
}

function onnotificationclick(event) {
  const data = event.notification.data
  event.notification.close()
  if (clients.openWindow && data.url) return clients.openWindow(data.url)
}

function onactivate(event) {
  event.waitUntil(self.clients.claim())
}

async function postMessage(message) {
  try {
    const clients = await self.clients.matchAll()
    for (const client of clients) {
      client.postMessage(message)
    }
  } catch (err) {
    console.error(err)
  }
}
