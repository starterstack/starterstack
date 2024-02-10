import process from 'node:process'
import AWSXRay from 'aws-xray-sdk-core'

const { LAMBDA_TASK_ROOT, AWS_EXECUTION_ENV } = process.env

export default function trace(client) {
  return LAMBDA_TASK_ROOT && AWS_EXECUTION_ENV
    ? AWSXRay.captureAWSv3Client(client)
    : client
}
