// @ts-check
import { addAlarms, addDashboard } from 'slic-watch-core'

/** @type {import('@starterstack/sam-expand/plugins').Lifecycles} */
export const lifecycles = ['pre:expand']

export const metadataConfig = 'slicWatch'

// eslint-disable-next-line @typescript-eslint/require-await
export const lifecycle = async function generateCloudwatchAlarms({
  command,
  template,
  lifecycle,
  log
}) {
  if (lifecycle === 'pre:expand' && command === 'build') {
    const config = template.Metadata.expand.config.slicWatch
    log('applying slic watch %O', { config })
    addAlarms(config.alarms, config.alarmActionsConfig, template)
    addDashboard(config.dashboard, template)
  }
}

export { slicWatchSchema as schema } from 'slic-watch-core'
