// @ts-check

import { promisify } from 'node:util'
import { exec } from 'node:child_process'

/** @type {import('@starterstack/sam-expand/plugins').Lifecycles} */
export const lifecycles = ['pre:package']

/** @type {import('@starterstack/sam-expand/plugins').Plugin} */
export const lifecycle = async function runScriptHook({
  template,
  log,
}) {
  const { stdout } = await promisify(exec)('git rev-parse HEAD')
  const shaCommit = stdout.replace(/[\r\n]/g, '').trim()
  log('adding git commit to outputs %O', { shaCommit })

  template.Outputs ||= {}
  template.Outputs['DeployedCommit'] = shaCommit
}
