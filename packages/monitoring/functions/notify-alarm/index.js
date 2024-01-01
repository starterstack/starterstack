import process from 'node:process'
import lambdaHandler from './lambda-handler.js'
import ssm from './ssm.js'
import './http.js'

export const handler = lambdaHandler(async function notify(
  event,
  context,
  { log, abortSignal }
) {
  log.debug({ event }, 'received')
  try {
    const { [`${process.env.SSM_SLACK_URL}`]: { value: slackUrl } = {} } =
      await ssm.get({
        name: process.env.SSM_SLACK_URL,
        abortSignal
      })

    if (!slackUrl) return
    const {
      Records: [
        {
          Sns: { Message: message, Subject: subject, TopicArn: topicArn }
        }
      ]
    } = event

    const accountId = topicArn.split(':')[4]

    await notifySlack({ slackUrl, abortSignal, message, subject, accountId })
  } catch (err) {
    log.error({ event }, err)
  }
})

async function notifySlack({
  slackUrl,
  abortSignal,
  message,
  subject,
  accountId
}) {
  const body = createNotification({ message, subject, accountId })

  if (body) {
    const res = await fetch(slackUrl, {
      signal: abortSignal,
      keepalive: true,
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
}

function createNotification({ message, subject, accountId }) {
  if (subject?.startsWith('ALARM:')) {
    return createAlarmBody({ message })
  } else if (subject === 'Upcoming budget amount adjustment on AWS Budgets') {
    return createBudgetAdjustment({ message, subject })
  } else if (
    subject?.startsWith('AWS Budgets:') &&
    subject?.includes('has exceeded your alert threshold')
  ) {
    return createBudgetAlarm({ message, subject, accountId })
  }
}

function createBudgetAlarm({ message, subject, accountId }) {
  return {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: subject,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${accountId}*`
        }
      },
      {
        type: 'divider'
      },
      ...message.split(/\n/).map(
        (text) =>
          text && {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text
            }
          }
      )
    ].filter(Boolean)
  }
}

function createBudgetAdjustment({ message, subject }) {
  const parsedMessage = JSON.parse(message)
  const { accountId: account } = parsedMessage

  delete parsedMessage.accountId

  return {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: subject,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${account}*`
        }
      },
      {
        type: 'divider'
      },
      ...Object.entries(parsedMessage).reduce((sum, [key, value]) => {
        if (value) {
          sum.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${key}:* ${
                typeof value !== 'object'
                  ? value
                  : JSON.stringify(value, null, 2)
              }`
            }
          })
        }
        return sum
      }, [])
    ]
  }
}

function createAlarmBody({ message }) {
  const {
    AlarmName: alarm,
    Region: region,
    AWSAccountId: account,
    NewStateReason: reason,
    StateChangeTime: reportedAt
  } = JSON.parse(message)
  return {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'CloudWatch Alarm',
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${region} / ${account}*`
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Alarm:* ${alarm}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Threshold:* ${reason}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Reported:* ${reportedAt}`
        }
      }
    ]
  }
}
