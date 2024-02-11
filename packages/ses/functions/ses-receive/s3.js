// @ts-check
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { S3Client } from '@aws-sdk/client-s3'
import AWSXRay from 'aws-xray-sdk-core'

/** @type S3Client */
export default trace(
  middleware(
    new S3Client({
      ...(process.env.IS_OFFLINE && {
        endpoint: 'http://localhost:4569',
        credentials: {
          accessKeyId: 'S3RVER',
          secretAccessKey: 'S3RVER'
        },
        region: 'us-east-1',
        forcePathStyle: true
      })
    })
  )
)

/**
 @type Record<string, S3Client>
*/
const endpointClients = {}

/**
 @param {string?} endpoint
 @returns S3Client
*/
export function withEndpoint(endpoint) {
  if (!endpointClients[String(endpoint)]) {
    endpointClients[String(endpoint)] = trace(
      middleware(
        // @ts-ignore
        new S3Client({
          ...(process.env.IS_OFFLINE && {
            endpoint,
            credentials: {
              accessKeyId: 'S3RVER',
              secretAccessKey: 'S3RVER'
            },
            region: 'us-east-1'
          }),
          forcePathStyle: true
        })
      )
    )
  }

  return endpointClients[String(endpoint)]
}

/**
 * @param {S3Client} client
 * @returns S3Client
 */

function middleware(client) {
  client.middlewareStack.add(
    (next, context) => (args) => {
      /** @type {any} */
      const input = args.input
      if (context.commandName === 'PutObjectCommand') {
        if (!input.StorageClass) {
          input.StorageClass = 'INTELLIGENT_TIERING'
        }

        // @ts-ignore
        const correlationIds = globalThis[Symbol.for('correlationIds')] ?? {}
        input.Metadata = {
          ...Object.entries({
            ...correlationIds,
            ...input.Metadata
          }).reduce(
            (
              /** @type{Object<string, string>} */
              sum,
              [k, v]
            ) => {
              if (v !== undefined) {
                sum[k] = encodeRfc2047(String(v))
              }
              return sum
            },
            {}
          )
        }
      } else if (context.commandName === 'CopyObjectCommand') {
        if (!input.MetadataDirective) {
          input.MetadataDirective = 'COPY'
        }
        if (!input.TaggingDirective) {
          input.TaggingDirective = 'COPY'
        }
        if (!input.StorageClass) {
          input.StorageClass = 'INTELLIGENT_TIERING'
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

/**
 * @param {string | undefined} value
 * @returns string
 */

export function encodeRfc2047(value) {
  return value && /[^\w!%&./;=~-]/i.test(value)
    ? `=?utf-8?b?${Buffer.from(value).toString('base64')}?=`
    : value ?? ''
}

function trace(/** @type any */ client) {
  return process.env.LAMBDA_TASK_ROOT && process.env.AWS_EXECUTION_ENV
    ? AWSXRay.captureAWSv3Client(client)
    : client
}
