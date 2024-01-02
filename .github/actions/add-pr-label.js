export default async function ({ github, context, label, issueNumber }) {
  const { owner, repo } = context.repo
  await github.rest.issues.addLabels({
    issue_number: issueNumber || context.payload.pull_request.number,
    owner,
    repo,
    labels: [label]
  })
}
