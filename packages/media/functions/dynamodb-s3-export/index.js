import process from 'node:process'
import lambdaHandler from './lambda-handler.js'
import { client as dynamodbClient } from './dynamodb.js'
import { ExportTableToPointInTimeCommand } from '@aws-sdk/client-dynamodb'

export const handler = lambdaHandler(async function s3Export(
  _event,
  _context,
  { abortSignal }
) {
  const { S3_BUCKET: s3Bucket, DYNAMODB_ARN_PREFIX: dynamodbArnPrefix } =
    process.env
  const tableArns = Object.entries(process.env)
    .filter(function isTableEnv([key]) {
      return key.startsWith('DYNAMODB_') && key.endsWith('TABLE')
    })
    .map(function mapTableArn([, value]) {
      return `${dynamodbArnPrefix}${value}`
    })

  await Promise.all(
    tableArns.map(function exportTable(tableArn) {
      return dynamodbClient.send(
        new ExportTableToPointInTimeCommand({
          S3Bucket: s3Bucket,
          S3SseAlgorithm: 'AES256',
          TableArn: tableArn,
          ExportFormat: 'DYNAMODB_JSON'
        }),
        {
          abortSignal
        }
      )
    })
  )

  return {}
})
