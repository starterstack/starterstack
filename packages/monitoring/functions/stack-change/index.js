import process from 'node:process'
import lambdaHandler from './lambda-handler.js'
import ssm from './ssm.js'

export const handler = lambdaHandler(async function notify(
  event,
  context,
  { log, abortSignal }
) {
  log.debug({ event }, 'received')
  try {
    const {
      Records: [
        {
          Sns: { Message: message }
        }
      ]
    } = event

    const parsedMessage = message
      .split(/'\n/)
      .filter(Boolean)
      .reduce((sum, line) => {
        const [key, value] = line.split(/='/)
        const trimmed = value.trim()
        if (trimmed && trimmed !== 'null') {
          if (trimmed.startsWith('{"')) {
            try {
              sum[key.trim()] = JSON.stringify(JSON.parse(trimmed), null, 2)
            } catch {
              sum[key.trim()] = trimmed
            }
          } else {
            sum[key.trim()] = trimmed
          }
        }
        return sum
      }, {})

    const {
      StackId: stackId,
      Timestamp: timestamp,
      EventId: eventId,
      Namespace: account,
      ResourceStatus: status = '',
      ResourceStatusReason: reason,
      StackName: stackName
    } = parsedMessage

    if (status?.includes('ROLLBACK') || status?.includes('FAILED')) {
      const { [`${process.env.SSM_SLACK_URL}`]: { value: slackUrl } = {} } =
        await ssm.get({
          name: process.env.SSM_SLACK_URL,
          abortSignal
        })

      if (!slackUrl) return

      for (const deleteProperty of [
        'StackId',
        'Timestamp',
        'LogicalResourceId',
        'EventId',
        'Namespace',
        'ResourceStatus',
        'ResourceStatusReason',
        'StackName',
        'ClientRequestToken'
      ]) {
        delete parsedMessage[deleteProperty]
      }

      const region = stackId.split(':')[3]

      const res = await fetch(slackUrl, {
        signal: abortSignal,
        keepalive: true,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: 'CloudFormation Deploy Failed',
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
                text: `*StackName:* ${stackName}`
              }
            },
            status && {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Status:* ${status}`
              }
            },
            eventId && {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*EventId:* ${eventId}`
              }
            },
            reason && {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Reason:* ${reason}`
              }
            },
            ...Object.entries(parsedMessage).reduce((sum, [key, value]) => {
              if (value && value !== 'null') {
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
            }, []),
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Time:* ${timestamp}`
              }
            }
          ].filter(Boolean)
        })
      })

      if (res.status !== 200) {
        throw new Error(`failed to fetch ${res.status}`)
      }

      const response = await res.text()

      if (response !== 'ok') {
        throw new Error(`failed to fetch ${response}`)
      }
    }
  } catch (err) {
    log.error({ event }, err)
  }
})
