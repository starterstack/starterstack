// @ts-check

/** @type {import('@starterstack/sam-expand/plugins').Lifecycles} */
export const lifecycles = ['pre:expand']

/** @type {import('@starterstack/sam-expand/plugins').Plugin} */
export const lifecycle = async function runScriptHook({
  command,
  template,
  spawn,
  log
}) {
  const stdout = String(await spawn('git', ['rev-parse', 'HEAD'], { shell: true }))

  const shaCommit = stdout.replace(/[\r\n]/g, '').trim()
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
