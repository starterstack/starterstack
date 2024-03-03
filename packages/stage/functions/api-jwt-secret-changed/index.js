import process from 'node:process'
import {
  APIGatewayClient,
  FlushStageAuthorizersCacheCommand
} from '@aws-sdk/client-api-gateway'
import lambdaHandler from './lambda-handler.js'
import '@aws-sdk/signature-v4-crt'
import {
  GetKeyCommand,
  ResourceNotFoundException,
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  PutKeyCommand
} from '@aws-sdk/client-cloudfront-keyvaluestore'
import getSecrets from './get-secrets.js'
import trace from './trace.js'
import { SignatureV4MultiRegion } from '@aws-sdk/signature-v4-multi-region'

const cloudFrontKeyValueStoreClient = new CloudFrontKeyValueStoreClient({
  signerConstructor: SignatureV4MultiRegion
})

const apigateway = trace(new APIGatewayClient({ apiVersion: '2015-07-09' }))

const { KvsARN, REST_API_ID, STAGE } = process.env

export const handler = lambdaHandler(async function update(
  event,
  _context,
  { abortSignal, log }
) {
  log.debug({ event }, 'received')
  try {
    const { ETag: etag } = await cloudFrontKeyValueStoreClient.send(
      new DescribeKeyValueStoreCommand({
        KvsARN
      }),
      { abortSignal }
    )
    const secrets = await getSecrets(abortSignal)
    const currentConfig = (await getCurrentConfig(abortSignal)) ?? {}

    if (
      !Object.entries(secrets.apiSecrets).every(
        ([key, value]) => currentConfig?.apiSecrets?.[key] === value
      )
    ) {
      await cloudFrontKeyValueStoreClient.send(
        new PutKeyCommand({
          KvsARN,
          IfMatch: etag,
          Key: 'config',
          Value: JSON.stringify({
            ...currentConfig,
            ...secrets
          })
        }),
        { abortSignal }
      )
    }
    if (event?.action !== 'refreshSecretOnly') {
      await apigateway.send(
        new FlushStageAuthorizersCacheCommand({
          restApiId: REST_API_ID,
          stageName: STAGE
        }),
        {
          abortSignal
        }
      )
    }
  } catch (error) {
    log.error({ event }, error)
    throw error
  }
})

/**
 * @param {AbortSignal} abortSignal
 * @returns {Promise<Record<string, any> | undefined>}
 */
async function getCurrentConfig(abortSignal) {
  try {
    const { Value: value } = await cloudFrontKeyValueStoreClient.send(
      new GetKeyCommand({
        KvsARN,
        Key: 'config'
      }),
      { abortSignal }
    )
    if (value) {
      return JSON.parse(value)
    }
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error
    }
  }
}
