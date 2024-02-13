// @ts-check
import process from 'node:process'
import { SESv2Client } from '@aws-sdk/client-sesv2'
import AWSXRay from 'aws-xray-sdk-core'

/** @type SESv2Client */
export default trace(createClient())

function createClient() {
  const client = new SESv2Client({
    region: 'eu-west-1',
    ...(process.env.IS_OFFLINE && {
      credentials: {
        accessKeyId: 'x',
        secretAccessKey: 'x'
      },
      endpoint: 'http://localhost:5012'
    })
  })
  client.middlewareStack.add(
    (next, context) => (args) => {
      if (
        context.commandName === 'SendEmailCommand' ||
        context.commandName === 'SendBulkEmailCommandInput'
      ) {
        /** @type any */
        const input = args.input
        // @ts-ignore
        const correlationIds = globalThis[Symbol.for('correlationIds')] ?? {}
        const correlationIdTags =
          input.EmailTags ?? input.DefaultEmailTags ?? []
        for (const [key, value] of Object.entries(correlationIds)) {
          if (
            value !== undefined &&
            !correlationIdTags.some((/** @type any */ x) => x.Name === key)
          ) {
            correlationIdTags.push({
              Name: key,
              Value: String(value)
                .replaceAll(/[^\w-]/gi, '')
                .slice(0, 256)
            })
          }
        }
        if (context.commandName === 'SendEmailCommand') {
          input.EmailTags = correlationIdTags
        } else if (context.commandName === 'SendBulkEmailCommandInput') {
          input.DefaultEmailTags = correlationIdTags
        }
      }
      return next(args)
    },
    {
      step: 'initialize',
      name: 'addTraceData',
      tags: ['metadata', 'traceData']
    }
  )
  return client
}

function trace(/** @type any */ client) {
  return process.env.LAMBDA_TASK_ROOT && process.env.AWS_EXECUTION_ENV
    ? AWSXRay.captureAWSv3Client(client)
    : client
}
