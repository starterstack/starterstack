// @ts-check
import process from 'node:process'
import { SFNClient } from '@aws-sdk/client-sfn'
import AWSXRay from 'aws-xray-sdk-core'

/** @type SFNClient */
export default trace(createClient())

function createClient() {
  const client = new SFNClient({})
  return client
}

function trace(/** @type any */ client) {
  return process.env.LAMBDA_TASK_ROOT && process.env.AWS_EXECUTION_ENV
    ? AWSXRay.captureAWSv3Client(client)
    : client
}
