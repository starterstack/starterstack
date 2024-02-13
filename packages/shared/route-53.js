// @ts-check
import process from 'node:process'
import { Route53Client } from '@aws-sdk/client-route-53'
import AWSXRay from 'aws-xray-sdk-core'

/** @type Route53Client */
export default trace(new Route53Client({}))

function trace(/** @type any */ client) {
  return process.env.LAMBDA_TASK_ROOT && process.env.AWS_EXECUTION_ENV
    ? AWSXRay.captureAWSv3Client(client)
    : client
}
