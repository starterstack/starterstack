export default async function ({ github, context, environment }) {
  const { owner, repo } = context.repo

  try {
    const { data: { environments = [] } = {} } =
      await github.rest.repos.getAllEnvironments({
        owner,
        repo
      })
    return !!environments.find((x) => x.name === environment)
  } catch (error) {
    if (error.status !== 404) throw error
  }

  try {
    const { data: deployments } = await github.rest.repos.listDeployments({
      owner,
      repo
    })

    for (const { environment: deploymentEnvironment } of deployments) {
      if (deploymentEnvironment === environment) {
        return true
      }
    }
  } catch (error) {
    if (error.status !== 404) throw error
  }
}
