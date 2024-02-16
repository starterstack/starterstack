import process from 'node:process'
import crypto from 'node:crypto'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { withEndpoint, encodeRfc2047 } from './s3.js'
import dynamodb from './dynamodb.js'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import ms from 'ms'

import lambdaHandler from './lambda-handler.js'

const {
  PRESIGN_SECONDS_EXPIRY = 300,
  MEDIA_BUCKET,
  PROTECTED_MEDIA_BUCKET,
  UPLOAD_MB_LIMIT = 30,
  STACK
} = process.env

export const handler = lambdaHandler(async function createPresignedPostHandler(
  event,
  context,
  { log, correlationIds, abortSignal }
) {
  log.debug({ event }, 'received')

  const { id: userId, aud } = event?.context ?? {}

  try {
    if (!userId || aud !== 'user') {
      throw new Error('missing token')
    }

    const {
      key,
      contentType,
      redirect,
      uploadType,
      visibility,
      id,
      originalUrl
    } = event.args

    const isProtected = visibility !== 'PUBLIC'

    const protectedPrefix = isProtected
      ? {
          PRIVATE: `~/user/${userId}/`,
          USERS: '~/role/1/'
        }[String(visibility)]
      : ''

    const bucket = isProtected ? PROTECTED_MEDIA_BUCKET : MEDIA_BUCKET

    const s3 = withEndpoint(
      process.env.IS_OFFLINE ? event.context.origin : undefined
    )

    const s3Key = `temp/${protectedPrefix}${crypto.randomUUID()}`

    const { url, fields } = await createPresignedPost(s3, {
      Bucket: bucket,
      Expires: Number(PRESIGN_SECONDS_EXPIRY),
      Fields: {
        'X-Amz-Meta-UploadedBy': userId,
        ...(id && { 'X-Amz-Meta-Id': id }),
        ...(originalUrl && { 'X-Amz-Meta-OriginalUrl': originalUrl }),
        'X-Amz-Meta-UploadType': uploadType,
        'X-Amz-Meta-UploadedAt': String(Date.now()),
        'X-Amz-Meta-Key': key,
        'X-Amz-Storage-Class': 'STANDARD',
        // documented https://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPOST.html
        Tagging: `<Tagging><TagSet><Tag><Key>ManagedBy</Key><Value>${STACK}</Value></Tag></TagSet></Tagging>`,
        ...Object.entries(correlationIds).reduce(
          /** @param {{[key: string]: string}} sum */
          (sum, [k, v]) => {
            if (v !== undefined) {
              sum[`X-Amz-Meta-${k}`] = encodeRfc2047(String(v))
            }
            return sum
          },
          {}
        ),
        'X-Amz-Meta-ProtectedPrefix': protectedPrefix,
        'cache-control': protectedPrefix
          ? 'must-revalidate, public, max-age=86400'
          : 'must-revalidate, public, max-age=31536000',
        ...(redirect && {
          success_action_redirect: `${
            process.env.IS_OFFLINE ? event.context.origin : process.env.BASE_URL
          }/uploaded/${encodeURIComponent(s3Key)}`
        }),
        ...(contentType && { 'content-type': contentType })
      },
      Key: s3Key,
      Conditions: [['content-length-range', 0, Number(UPLOAD_MB_LIMIT) * 1e6]]
    })

    log.debug({ url, fields }, 'presigned fields')

    await dynamodb.send(
      new PutCommand({
        TableName: process.env.DYNAMODB_STACK_TABLE,
        Item: {
          pk: `upload#${s3Key}`,
          sk: `upload#${s3Key}`,
          ttl: Math.floor((Date.now() + ms('1 hour')) / 1000),
          userId
        },
        ReturnValues: 'NONE'
      }),
      {
        abortSignal
      }
    )

    return {
      value: {
        url,
        fields: Object.entries(fields).reduce((sum, [k, v]) => {
          sum.push({ name: k, value: v })
          return sum
        }, [])
      }
    }
  } catch (error) {
    log.error({ event }, error)
    throw error
  }
})
