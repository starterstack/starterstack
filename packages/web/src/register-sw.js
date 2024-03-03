export default async function register() {
  if (
    window.location.protocol !== 'https:' &&
    !window.localStorage.getItem('sw_test')
  ) {
    return
  }

  if ('serviceWorker' in navigator) {
    const url = '/service-worker.js'

    window.navigator.serviceWorker.addEventListener('message', ({ data }) => {
      if (data.action === 'error') {
        console.error(data.error)
      }
    })
    try {
      const registration = await navigator.serviceWorker.register(url)
      registration.onupdatefound = () => {
        const installingWorker = registration.installing
        if (!installingWorker) return
        installingWorker.onstatechange = () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              console.log('New content is available; refresh needed.')
            } else {
              console.log('Content is cached for offline use.')
            }
          }
        }
      }
      if (window.navigator.serviceWorker.controller) {
        window.navigator.serviceWorker.controller.postMessage({
          action: 'refresh'
        })
        if (registration.update) registration.update()
      }
    } catch (err) {
      console.error(err)
    }
  }
}
