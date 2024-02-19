import process from 'node:process'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb'
import lambdaHandler from './lambda-handler.js'
import crypto from 'node:crypto'
import dynamodb from './dynamodb.js'
import createBatchWriter from './dynamodb-create-batch-writer.js'

export const handler = lambdaHandler(async function audit(
  event,
  context,
  { abortSignal, log }
) {
  try {
    log.debug({ event }, 'received')
    const batchWrite = createBatchWriter({
      dynamodb,
      BatchWriteCommand,
      log,
      abortSignal,
      tableName: process.env.DYNAMODB_AUDIT_TABLE
    })
    for (const {
      eventName,
      dynamodb: {
        Keys: keys,
        NewImage: newImage,
        OldImage: oldImage,
        ApproximateCreationDateTime: approximateCreationDateTime
      }
    } of event) {
      const { pk, sk } = unmarshall(keys)
      const snapshot = unmarshall(newImage ?? oldImage)
      await batchWrite({
        items: [
          {
            pk: `${pk}#${sk}`,
            sk: `${(approximateCreationDateTime * 1000).toString(32)}#${crypto
              .randomBytes(4)
              .toString('hex')}`,
            type: snapshot.type,
            audit: eventName.toLowerCase(),
            snapshot
          }
        ]
      })
    }

    await batchWrite({ flush: true })
  } catch (error) {
    log.error({ event }, error)
    throw error
  }
})
