export default async function ({ github, context, environment }) {
  const { owner, repo } = context.repo

  try {
    await github.rest.repos.deleteAnEnvironment({
      owner,
      repo,
      environment_name: environment
    })
    return
  } catch (error) {
    if (error.status !== 404) throw error
  }

  while (true) {
    const { data: deployments } = await github.rest.repos.listDeployments({
      owner,
      repo,
      environment
    })

    if (deployments.length === 0) {
      break
    }

    for (const { id } of deployments) {
      try {
        await github.rest.repos.createDeploymentStatus({
          owner,
          repo,
          deployment_id: id,
          state: 'failure'
        })
        await github.rest.repos.deleteDeployment({
          owner,
          repo,
          deployment_id: id
        })
      } catch (error) {
        if (error.status !== 404) throw error
      }
    }
  }

  if (context.payload.pull_request) {
    try {
      await github.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: context.payload.pull_request.number,
        name: 'feature deploy'
      })
    } catch (error) {
      if (error.status !== 404) throw error
    }
  }
}
