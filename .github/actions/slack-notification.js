import process from 'node:process'

export default async function ({ context, name, url, success }) {
  if (!process.env.SLACK_WEBHOOK_URL) {
    return
  }
  const runUrl = `${context.payload.repository.html_url}/actions/runs/${context.runId}`

  const pullRequest = context?.payload?.pull_request
  const headCommit = context?.payload?.head_commit

  const commitUrl = pullRequest?.html_url ?? headCommit?.url

  const commitUrlText = pullRequest
    ? `Pull request #${pullRequest.number}`
    : context.sha?.slice?.(0, 7)

  const body = {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `GitHub Actions Run ${
            success ? ':white_check_mark:' : 'failed :x:'
          }`,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${context.workflow} / ${context.eventName}*`
        }
      },
      {
        type: 'divider'
      },
      context.workflow === 'delete stage'
        ? {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `<${runUrl}|delete environment run> ${name} by ${context.actor}`
            }
          }
        : context.workflow === 'automerge'
          ? {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `<${runUrl}|automerge run> by ${context.actor}`
              }
            }
          : {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `<${runUrl}|deploy environment run> to ${
                  url ? `<${url}|${name}>` : name
                } by ${context.actor}`
              }
            },
      commitUrl && {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<${commitUrl}|${commitUrlText}>`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${
            pullRequest?.title ?? headCommit?.message ?? 'triggered manually'
          }`
        }
      }
    ].filter(Boolean)
  }
  const res = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (res.status < 200 || res.status > 299) {
    throw new Error(`failed to fetch ${res.status}`)
  }

  const response = await res.text()

  if (response !== 'ok') {
    throw new Error(`failed to fetch ${response}`)
  }
}
