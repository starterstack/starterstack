import registerSW from './register-sw'

export default function register() {
  let hidden
  let visibilityChange
  let refresh

  if (typeof window.document.hidden !== 'undefined') {
    hidden = 'hidden'
    visibilityChange = 'visibilitychange'
  } else if (typeof window.document.msHidden !== 'undefined') {
    hidden = 'msHidden'
    visibilityChange = 'msvisibilitychange'
  } else if (typeof window.document.webkitHidden !== 'undefined') {
    hidden = 'webkitHidden'
    visibilityChange = 'webkitvisibilitychange'
  }

  if (
    window.document.addEventListener &&
    typeof window.document[hidden] !== 'undefined'
  ) {
    window.document.addEventListener(visibilityChange, onChange, false)
  }

  if ('serviceWorker' in navigator) {
    window.navigator.serviceWorker.addEventListener('message', ({ data }) => {
      if (data.action === 'refresh') {
        refresh = true
      }
    })
  }

  function onChange() {
    const visible = !window.document[hidden]
    if (visible) {
      registerSW()
    } else {
      if (refresh) {
        window.location.reload()
      }
    }
  }
}
