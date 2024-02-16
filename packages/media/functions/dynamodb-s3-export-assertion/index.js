import process from 'node:process'
import lambdaHandler from './lambda-handler.js'
import { client as dynamodbClient } from './dynamodb.js'
import {
  ListExportsCommand,
  DescribeExportCommand
} from '@aws-sdk/client-dynamodb'
import ms from 'ms'

export const handler = lambdaHandler(async function s3ExportAssertion(
  event,
  context,
  { log, abortSignal }
) {
  const now = Date.now()
  const { DYNAMODB_ARN_PREFIX: dynamodbArnPrefix } = process.env
  const tableArns = Object.entries(process.env)
    .filter(function isTableEnv([key]) {
      return key.startsWith('DYNAMODB_') && key.endsWith('TABLE')
    })
    .map(function mapTableArn([, value]) {
      return `${dynamodbArnPrefix}${value}`
    })

  const { ExportSummaries: allExports } = await dynamodbClient.send(
    new ListExportsCommand({}),
    {
      abortSignal
    }
  )

  const matchedExports = allExports.filter(function filterExport(s3Export) {
    return (
      tableArns.includes(exportArnToTableArn(s3Export.ExportArn)) &&
      s3Export.ExportStatus === 'COMPLETED'
    )
  })

  const details = await Promise.all(
    matchedExports.map(function describeExport(s3Export) {
      return dynamodbClient.send(
        new DescribeExportCommand({ ExportArn: s3Export.ExportArn }),
        { abortSignal }
      )
    })
  )

  const completedToday = [
    ...new Set(
      details.filter(function matchCompletedExport(details) {
        return now - details.ExportDescription.ExportTime < ms('1 day')
      })
    )
  ].map(function toTableArn(details) {
    return exportArnToTableArn(details.ExportDescription.ExportArn)
  })

  if (completedToday.length < tableArns.length) {
    const missingExports = new Error('missing s3 exports')
    log.error(
      { allExports, matchedExports, details, completedToday },
      missingExports
    )
    throw missingExports
  }

  return {}
})

function exportArnToTableArn(exportArn) {
  return exportArn.split('/').slice(0, 2).join('/')
}
