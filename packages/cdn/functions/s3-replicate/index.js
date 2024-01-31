import process from 'node:process'
import { CopyObjectCommand, S3Client } from '@aws-sdk/client-s3'
import AWSXRay from 'aws-xray-sdk-core'
import lambdaHandler from './lambda-handler.js'

const { S3_BACKUP_BUCKET: destination, S3_BACKUP_BUCKET_REGION: region } =
  process.env

const s3 = AWSXRay.captureAWSv3Client(
  new S3Client({
    region
  })
)

export const handler = lambdaHandler(async function trigger(
  event,
  context,
  { abortSignal, log }
) {
  try {
    const {
      detail: {
        object: { key },
        bucket: { name: source }
      }
    } = event
    const prefix = source.split('-').slice(0, -1).join('-')
    await s3.send(
      new CopyObjectCommand({
        ACL: 'bucket-owner-full-control',
        Bucket: destination,
        CopySource: `${source}/${key}`,
        Key: `${prefix}/${key}`,
        StorageClass: 'STANDARD_IA',
        ServerSideEncryption: 'AES256',
        TaggingDirective: 'COPY',
        MetadataDirective: 'COPY'
      }),
      {
        abortSignal
      }
    )
  } catch (err) {
    log.error({ event }, err)
    throw err
  }
})
