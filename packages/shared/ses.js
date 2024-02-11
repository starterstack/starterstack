// @ts-check
import process from 'node:process'
import { SESClient } from '@aws-sdk/client-ses'
import AWSXRay from 'aws-xray-sdk-core'

/** @type SESClient */
export default trace(
  new SESClient({
    region: 'eu-west-1'
  })
)

function trace(/** @type any */ client) {
  return process.env.LAMBDA_TASK_ROOT && process.env.AWS_EXECUTION_ENV
    ? AWSXRay.captureAWSv3Client(client)
    : client
}
