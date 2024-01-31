export default class ApiGatewayDeployment {
  constructor(serverless) {
    this.hooks = {
      'after:aws:package:finalize:mergeCustomProviderResources': () =>
        this.randomizeDeploymentLogicalIds(serverless)
    }
  }

  randomizeDeploymentLogicalIds(serverless) {
    const instanceId = serverless.instanceId
    const resources =
      serverless.service.provider.compiledCloudFormationTemplate.Resources
    for (const resource of Object.values(resources)) {
      if (resource.Type === 'AWS::ApiGateway::Stage') {
        const deploymentId = resource.Properties.DeploymentId?.Ref
        if (deploymentId) {
          const newDeploymentId = `${deploymentId}${instanceId}`
          resources[newDeploymentId] = structuredClone(resources[deploymentId])
          resource.Properties.DeploymentId.Ref = newDeploymentId
          delete resources[deploymentId]
          serverless.cli.log(`replaced ${deploymentId} with ${newDeploymentId}`)
        }
      }
    }
  }
}
