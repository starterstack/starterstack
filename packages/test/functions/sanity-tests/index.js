import './http.js'
import lambdaHandler from './lambda-handler.js'
import assertSSR from './assertions/ssr.js'
import assertNotFoundHeaders from './assertions/not-found-headers.js'
import assertGraphQL from './assertions/graphql.js'
import assertWebSocket from './assertions/websocket.js'
import assertFileUpload from './assertions/file-upload.js'

export const handler = lambdaHandler(async function runTests(
  { tokens },
  _,
  { log, abortSignal }
) {
  await Promise.all([
    assertNotFoundHeaders(tokens, { log, abortSignal }),
    assertSSR(tokens, { log, abortSignal }),
    assertGraphQL(tokens, { log, abortSignal }),
    assertWebSocket(tokens, { log, abortSignal }),
    assertFileUpload(tokens, { log, abortSignal })
  ])

  return {
    tokens
  }
})
