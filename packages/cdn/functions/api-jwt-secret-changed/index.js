import process from 'node:process'
import { createRequire } from 'node:module'
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
import {
  ApiGatewayV2Client,
  ResetAuthorizersCacheCommand
} from '@aws-sdk/client-apigatewayv2'
import AWSXRay from 'aws-xray-sdk-core'
import lambdaHandler from './lambda-handler.js'

const require = createRequire(import.meta.url)
const request = require('../../resources/cloudfront-viewer-request')

const cloudfront = trace(new CloudFrontClient({ apiVersion: '2020-05-31' }))
const apigatewayv2 = trace(new ApiGatewayV2Client({ apiVersion: '2018-11-29' }))
const apigateway = trace(new APIGatewayClient({ apiVersion: '2015-07-09' }))

const {
  CLOUDFRONT_VIEWER_REQUEST_ARN,
  STACK_NAME,
  STAGE_ROOT,
  STAGE,
  REST_API_ID,
  HTTP_API_ID,
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
      apigatewayv2.send(
        new ResetAuthorizersCacheCommand({
          ApiId: HTTP_API_ID,
          StageName: '$default'
        }),
        {
          abortSignal
        }
      ),
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
