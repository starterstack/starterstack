import React, { useEffect, useState } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import reportWebVitals from './reportWebVitals'
import registerSW from './register-sw'
import registerVisibility from './register-visibility'
import router from './router'
import './index.css'

//@ts-ignore
import FetchData from './fetch-data.mjs'

renderApp().catch(console.error)

declare global {
  interface Window {
    __INJECT__STATE__: any | undefined
  }
}

async function renderApp() {
  const fetchData = FetchData('', fetch, crypto)
  const injectedState = window.__INJECT__STATE__
  const state =
    injectedState ||
    (await fetchData(window.location.pathname + window.location.search))
  const rootEl = window.document.getElementById('root')
  const DefaultPage = await router(window.location.pathname)
  const Page = () => {
    const [CurrentPage, setCurrentPage] = useState(
      <DefaultPage state={state} />
    )
    useEffect(() => {
      async function prepareNewPage(pathname: string) {
        try {
          const newState = await fetchData(pathname, state)
          const Page = await router(pathname)
          setCurrentPage(<Page state={newState} />)
        } catch (err) {
          console.error(err)
        }
      }

      function onPopstate() {
        prepareNewPage(window.location.pathname)
      }

      async function onNavigate(e: any) {
        const pathname: string = e.detail.pathname
        if (window.location.pathname !== pathname) {
          await prepareNewPage(pathname)
          window.history.pushState(null, '', pathname)
        }
      }
      window.addEventListener('popstate', onPopstate)
      window.addEventListener('navigate', onNavigate)

      function removeEventListeners() {
        window.removeEventListener('popstate', onPopstate)
        window.removeEventListener('navigate', onNavigate)
      }

      return removeEventListeners
    }, [])
    return <div>{CurrentPage}</div>
  }
  const component = (
    <React.StrictMode>
      <Page />
    </React.StrictMode>
  )
  if (rootEl!.hasChildNodes()) {
    hydrateRoot(rootEl!, component)
  } else {
    createRoot(rootEl!).render(component)
  }

  // If you want to start measuring performance in your app, pass a function
  // to log results (for example: reportWebVitals(console.log))
  // or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
  reportWebVitals()
  registerVisibility()
  registerSW()
}
