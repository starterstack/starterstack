import './http.js'
import lambdaHandler from './lambda-handler.js'
import assertGraphQL from './assertions/graphql.js'
import assertWebSocket from './assertions/websocket.js'
import assertFileUpload from './assertions/file-upload.js'

export const handler = lambdaHandler(async function runTests(
  { tokens },
  context,
  { log, abortSignal }
) {
  await Promise.all([
    assertGraphQL(tokens, { log, abortSignal }),
    assertWebSocket(tokens, { log, abortSignal }),
    assertFileUpload(tokens, { log, abortSignal })
  ])

  return {
    tokens
  }
})
