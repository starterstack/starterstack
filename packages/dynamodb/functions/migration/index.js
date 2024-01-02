import lambdaHandler from './lambda-handler.js'
import runMigrations from './migrations/run.js'

export const handler = lambdaHandler(async function migration(
  event,
  context,
  { log, abortSignal }
) {
  await runMigrations({
    log,
    abortSignal
  })

  return {}
})
