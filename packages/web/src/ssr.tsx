import React from 'react'
import { renderToString } from 'react-dom/server'
import { ServerStyleSheet, StyleSheetManager } from 'styled-components'
import './index.css'
import router from './router'

export const ssr = async (state: any) => {
  const sheet = new ServerStyleSheet()
  try {
    const Page = await router(state.url)
    const html = renderToString(
      <React.StrictMode>
        <StyleSheetManager sheet={sheet.instance}>
          <div>
            <Page state={state} />
          </div>
        </StyleSheetManager>
      </React.StrictMode>
    )
    return {
      html,
      style: sheet.getStyleTags()
    }
  } finally {
    sheet.seal()
  }
}

// Don't remove the next line it's needed by vm, to run this function in node.
// @ts-ignore
if (typeof setVMSSRFunction !== 'undefined') setVMSSRFunction(ssr) // eslint-disable-line
