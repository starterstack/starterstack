import { APIGatewayClient } from '@aws-sdk/client-api-gateway'
import AWSXRay from 'aws-xray-sdk-core'

export default function createClient() {
  return trace(new APIGatewayClient())
}

function trace(client) {
  return process.env.LAMBDA_TASK_ROOT && process.env.AWS_EXECUTION_ENV
    ? AWSXRay.captureAWSv3Client(client)
    : client
}
