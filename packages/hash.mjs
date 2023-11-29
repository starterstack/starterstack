// @ts-check

import calculateHash from '../scripts/directory-hash.mjs'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('@starterstack/sam-expand/plugins').Lifecycles} */
export const lifecycles = ['pre:expand']

/** @type {import('@starterstack/sam-expand/plugins').Plugin} */
export const lifecycle = async function runScriptHook({
  command,
  template,
  log
}) {
  const sha1 = await calculateHash({
    root: process.cwd(),
    packagesRoot: __dirname
  })

  log('adding hash to outputs %O', { sha1, command })

  template.Outputs ||= {}
  template.Outputs['DeployedHash'] = {
    Description: 'computed sha1 of stack',
    Value: sha1,
    Export: {
      Name: {
        'Fn::Sub': '${AWS::StackName}DeployedHash'
      }
    }
  }
}
