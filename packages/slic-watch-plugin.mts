// @ts-check
import { addAlarms, addDashboard } from 'slic-watch-core'

import type { Plugin, Lifecycles } from '@starterstack/sam-expand/plugins'

export const lifecycles: Lifecycles = ['pre:expand']

export const metadataConfig = 'slicWatch'

export { slicWatchSchema as schema } from 'slic-watch-core'

// eslint-disable-next-line @typescript-eslint/require-await
export const lifecycle: Plugin = async function generateCloudwatchAlarms({
  command,
  template,
  lifecycle,
  log
}) {
  if (lifecycle === 'pre:expand' && command === 'build') {
    const config = template.Metadata.expand.config.slicWatch
    log('applying slic watch %O', { config })
    addAlarms(config.alarms, config.alarmActionsConfig, template)
    if (config.dashboard?.enabled) {
      addDashboard(config.dashboard, template)
    }
  }
}
