import process from 'node:process'
import {
  CloudFrontClient,
  DescribeFunctionCommand,
  UpdateFunctionCommand,
  PublishFunctionCommand
} from '@aws-sdk/client-cloudfront'
import {
  APIGatewayClient,
  FlushStageAuthorizersCacheCommand
} from '@aws-sdk/client-api-gateway'
import AWSXRay from 'aws-xray-sdk-core'
import lambdaHandler from './lambda-handler.js'
import '@aws-sdk/signature-v4-crt'
import { GetKeyCommand, CloudFrontKeyValueStoreClient, DescribeKeyValueStoreCommand, PutKeyCommand } from '@aws-sdk/client-cloudfront-keyvaluestore'

const cloudFrontKeyValueStoreClient = new CloudFrontKeyValueStoreClient({ region: 'us-east-1' })

const cloudfront = trace(new CloudFrontClient({ apiVersion: '2020-05-31' }))
const apigateway = trace(new APIGatewayClient({ apiVersion: '2015-07-09' }))

const {
  KvsARN,
  REST_API_ID,
  LAMBDA_TASK_ROOT,
  AWS_EXECUTION_ENV
} = process.env

export const handler = lambdaHandler(async function update(
  event,
  context,
  { abortSignal, log }
) {
  log.debug({ event }, 'received')
  try {
    // TODO
    const { ETag: etag } = await client.send(new DescribeKeyValueStoreCommand({
      KvsARN
    }))
    const updatedFunctions = await Promise.all(
      [CLOUDFRONT_VIEWER_REQUEST_ARN].map(async function updateFunction(arn) {
        const viewerName = arn.split('/').at(-1)
        const existing = await cloudfront.send(
          new DescribeFunctionCommand({
            Name: viewerName,
            Stage: 'DEVELOPMENT'
          }),
          {
            abortSignal
          }
        )

        const code = request

        const replaced = await cloudfront.send(
          new UpdateFunctionCommand({
            Name: viewerName,
            FunctionCode: new TextEncoder('utf8').encode(
              await code({
                stackName: STACK_NAME,
                stageRoot: STAGE_ROOT,
                stage: STAGE
              })
            ),
            FunctionConfig: existing.FunctionSummary.FunctionConfig,
            IfMatch: existing.ETag
          }),
          {
            abortSignal
          }
        )

        return {
          viewerName,
          etag: replaced.ETag
        }
      })
    )

    await Promise.all([
      ...updatedFunctions.map(async function publishFunction({
        viewerName,
        etag
      }) {
        await cloudfront.send(
          new PublishFunctionCommand({
            Name: viewerName,
            IfMatch: etag
          }),
          {
            abortSignal
          }
        )
      }),
      apigateway.send(
        new FlushStageAuthorizersCacheCommand({
          restApiId: REST_API_ID,
          stageName: STAGE
        }),
        {
          abortSignal
        }
      )
    ])
  } catch (error) {
    log.error({ event }, error)
    throw error
  }
})

function trace(client) {
  return LAMBDA_TASK_ROOT && AWS_EXECUTION_ENV
    ? AWSXRay.captureAWSv3Client(client)
    : client
}
