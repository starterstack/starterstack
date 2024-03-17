// @ts-check
import process from 'node:process'
import { EventBridgeClient } from '@aws-sdk/client-eventbridge'
import AWSXRay from 'aws-xray-sdk-core'

const eventBusRegion = process.env.EVENTBRIDGE_BUS_NAME?.split(':')?.[3]

/** @type EventBridgeClient */
export default trace(createClient())

/**
 @param {import('@aws-sdk/client-eventbridge').PutEventsResponse} options
*/
export function assertFailedEntries({
  FailedEntryCount: failedEntryCount,
  Entries: entries
} = {}) {
  if (failedEntryCount !== undefined && failedEntryCount > 0) {
    throw new Error(`assertFailedEntries failed ${JSON.stringify(entries)}`)
  }
}

/** @returns EventBridgeClient */
function createClient() {
  const client = new EventBridgeClient({
    apiVersion: '2015-10-07',
    ...(eventBusRegion && { region: eventBusRegion })
  })
  client.middlewareStack.add(
    (next, context) => (args) => {
      if (context.commandName === 'PutEventsCommand') {
        // @ts-ignore
        const correlationIds = globalThis[Symbol.for('correlationIds')] ?? {}
        /** @type {any} */
        const input = args.input
        for (const entry of input.Entries) {
          const json = entry.Detail ? JSON.parse(entry.Detail) : {}
          if (json.correlationIds === undefined) {
            json.correlationIds = correlationIds
            entry.Detail = JSON.stringify(json)
          }
        }
      }
      return next(args)
    },
    {
      step: 'initialize',
      name: 'addTraceData',
      tags: ['metadata', 'traceData']
    }
  )

  return client
}

function trace(/** @type any */ client) {
  return process.env.LAMBDA_TASK_ROOT && process.env.AWS_EXECUTION_ENV
    ? AWSXRay.captureAWSv3Client(client)
    : client
}
