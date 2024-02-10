// @ts-check

import log from '@starterstack/sam-expand/log'

/** @type {import('@starterstack/sam-expand/plugins').Lifecycles} */
export const lifecycles = ['pre:expand']

/** @type {import('@starterstack/sam-expand/plugins').Plugin} */
// eslint-disable-next-line @typescript-eslint/require-await
export const lifecycle = async function randomizeDeploymentLogicalIds({
  command,
  template
}) {
  if (command === 'build') {
    const randomSuffix = Date.now().toString(32)
    const resources = template.Resources
    for (const resource of Object.values(resources)) {
      if (resource.Type === 'AWS::ApiGateway::Stage') {
        const deploymentId = resource.Properties.DeploymentId?.Ref
        if (deploymentId) {
          const newDeploymentId = `${deploymentId}${randomSuffix}`
          resources[newDeploymentId] = structuredClone(resources[deploymentId])
          resource.Properties.DeploymentId.Ref = newDeploymentId
          delete resources[deploymentId]
          log('randomize api gateway stages to force redeployment %O', {
            deploymentId,
            newDeploymentId
          })
        }
      }
    }
  }
}
