// @ts-check
import process from 'node:process'
import { LambdaClient } from '@aws-sdk/client-lambda'
import AWSXRay from 'aws-xray-sdk-core'

/**
  @param {import('@aws-sdk/client-lambda').LambdaClientConfig} args
  @returns LambdaClient
*/
export default function createLambdaClient(args) {
  // @ts-ignore
  const client = new LambdaClient(args)
  client.middlewareStack.add(
    (next, context) => (args) => {
      if (context.commandName === 'InvokeCommand') {
        // @ts-ignore
        const correlationIds = globalThis[Symbol.for('correlationIds')] ?? {}
        // @ts-ignore
        const json = args.input.Payload ? JSON.parse(args.input.Payload) : {}
        json.correlationIds = correlationIds
        // @ts-ignore
        args.input.Payload = JSON.stringify(json)
      }
      return next(args)
    },
    {
      step: 'initialize',
      name: 'addTraceData',
      tags: ['metadata', 'traceData']
    }
  )
  return trace(client)
}

function trace(/** @type any */ client) {
  return process.env.LAMBDA_TASK_ROOT && process.env.AWS_EXECUTION_ENV
    ? AWSXRay.captureAWSv3Client(client)
    : client
}
