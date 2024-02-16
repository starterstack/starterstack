import process from 'node:process'
import lambdaHandler from './lambda-handler.js'
import eventBridge, { assertFailedEntries } from './eventbridge.js'
import { PutEventsCommand } from '@aws-sdk/client-eventbridge'
import eachSlice from './each-slice.js'
import { unmarshall } from '@aws-sdk/util-dynamodb'

const { EVENTBRIDGE_BUS_NAME } = process.env

export const handler = lambdaHandler(async function expired(
  event,
  context,
  { log, abortSignal }
) {
  log.debug({ event }, 'received')

  try {
    for (const items of eachSlice({ items: event, size: 10 })) {
      assertFailedEntries(
        await eventBridge.send(
          new PutEventsCommand({
            Entries: items.map((item) => {
              const deleted = unmarshall(item.dynamodb.OldImage)
              const { source, detailType, detail } = deleted.ttlEvent
              return {
                EventBusName: EVENTBRIDGE_BUS_NAME,
                Source: source,
                DetailType: detailType,
                Detail: JSON.stringify(
                  detail ?? {
                    ...deleted,
                    ttlEvent: undefined
                  }
                )
              }
            })
          }),
          {
            abortSignal
          }
        )
      )
    }
  } catch (error) {
    log.error({ event }, error)
    throw error
  }
})
