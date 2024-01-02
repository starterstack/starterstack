export default async function ({ github, context, body, issueNumber }) {
  const { owner, repo } = context.repo

  await github.rest.issues.createComment({
    issue_number: issueNumber || context.payload.pull_request.number,
    owner,
    repo,
    body
  })
}
