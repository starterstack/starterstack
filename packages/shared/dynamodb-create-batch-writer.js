// @ts-check
/**
 * @typedef {import('@aws-sdk/client-dynamodb').DynamoDBClient | import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient} DynamoDBClient
 * @typedef {typeof import('@aws-sdk/client-dynamodb').BatchWriteItemCommand | typeof import('@aws-sdk/lib-dynamodb').BatchWriteCommand} BatchWriteCommand
 * @typedef {import('./lambda-handler.js').Log} Log
 * @param {{
     dynamodb: DynamoDBClient,
     BatchWriteCommand: BatchWriteCommand,
     log?: Log,
     abortSignal: AbortSignal,
     tableName: string,
     onProgress?: (count: number) => void
  }} options
  @returns {function({
    items?: any[],
    flush?: boolean
  }): Promise<void>}
*/
export default function createBatchWriter({
  dynamodb,
  BatchWriteCommand,
  log,
  abortSignal,
  tableName,
  onProgress = (f) => f
}) {
  let count = 0
  /** @type {any[]} */
  const pending = []
  return async function write({ items = [], flush = false }) {
    pending.push(...items)
    const shouldProcess = () =>
      pending.length >= 25 || (pending.length > 0 && flush)
    while (shouldProcess()) {
      const batch = pending.splice(0, 25)
      count += batch.length
      if (count % 500 === 0) {
        log?.debug(`written ${count} to DynamoDB`)
      }
      try {
        // @ts-ignore overloading dynamodb makes send incompatible
        const { UnprocessedItems: unprocessedItems } = await dynamodb.send(
          new BatchWriteCommand({
            RequestItems: {
              [tableName]: batch.map((item) => ({
                PutRequest: {
                  Item: {
                    ...item
                  }
                }
              }))
            }
          }),
          {
            abortSignal
          }
        )
        if (Object.keys(unprocessedItems).length > 0) {
          throw new Error(`unprocessed ${JSON.stringify(unprocessedItems)}`)
        }
        onProgress(count)
      } catch (error) {
        log?.error({ batch }, error)
        throw error
      }
    }
    if (flush && count > 0) {
      log?.debug(`written ${count} to DynamoDB`)
    }
  }
}
