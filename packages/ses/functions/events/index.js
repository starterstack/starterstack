import process from 'node:process'
import { PutEventsCommand } from '@aws-sdk/client-eventbridge'
import eventbridge, { assertFailedEntries } from './eventbridge.js'
import lambdaHandler from './lambda-handler.js'

export const handler = lambdaHandler(async function events(
  event,
  context,
  { log, abortSignal }
) {
  log.debug({ event }, 'received')
  const records = event.Records.filter((x) => x.Sns.Type === 'Notification')
  for (const record of records) {
    const message = JSON.parse(
      record.Sns.Message,
      function stripProto(key, value) {
        return key === '__proto__' ? undefined : value
      }
    )
    const timestamp = record.Sns.Timestamp
    const eventType = message.eventType
    const mail = message.mail
    if (!mail.tags.type) {
      return
    }
    switch (mail.tags.type[0]) {
      case 'login': {
        await handleLogin({ abortSignal, eventType, mail, timestamp })
        break
      }
      default: {
        log.warn({ type: mail?.tags?.type?.[0], message }, 'type not supported')
      }
    }
  }
})

async function handleLogin({ abortSignal, eventType, mail, timestamp }) {
  const email = mail.destination[0]
  const correlationId = mail.tags.correlationId[0]
  assertFailedEntries(
    await eventbridge.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: process.env.EVENTBRIDGE_BUS_NAME,
            Source: 'email-event',
            DetailType: 'login',
            Detail: JSON.stringify({
              eventType,
              timestamp,
              email,
              correlationId
            })
          }
        ]
      }),
      {
        abortSignal
      }
    )
  )
}
