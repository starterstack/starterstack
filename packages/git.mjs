// @ts-check

import spawn from '@starterstack/sam-expand/spawn'

/** @type {import('@starterstack/sam-expand/plugins').Lifecycles} */
export const lifecycles = ['pre:expand']

const stdout = String(await spawn('git', ['rev-parse', 'HEAD'], { shell: true }))
const shaCommit = stdout.replace(/[\r\n]/g, '').trim()

export default async function settings() {
  return {
    get commit() {
      return shaCommit
    }
  }
}

/** @type {import('@starterstack/sam-expand/plugins').Plugin} */
export const lifecycle = async function runScriptHook({
  command,
  template,
  log
}) {
  if (command !== 'build') {
    log('skipping git commit %O', { command })
    return
  }

  log('adding git commit to outputs %O', { shaCommit, command })

  template.Outputs ||= {}
  template.Outputs['DeployedCommit'] = {
    Description: 'git commit sha deployed',
    Value: shaCommit,
    Export: {
      Name: {
        'Fn::Sub': '${AWS::StackName}DeployedCommit'
      }
    }
  }
}
