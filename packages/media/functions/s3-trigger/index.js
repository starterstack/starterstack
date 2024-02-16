import process from 'node:process'
import sharp from 'sharp'
import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import ms from 'ms'
import dynamodb from './dynamodb.js'
import { fileTypeFromFile } from 'file-type'
import os from 'node:os'

import { PutEventsCommand } from '@aws-sdk/client-eventbridge'
import { PutCommand } from '@aws-sdk/lib-dynamodb'

import {
  HeadObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  GetObjectTaggingCommand
} from '@aws-sdk/client-s3'

import eventBridge, { assertFailedEntries } from './eventbridge.js'
import s3 from './s3.js'
import lambdaHandler, { prefix } from './lambda-handler.js'

export const handler = lambdaHandler(async function trigger(
  event,
  _context,
  { abortSignal, log, replaceCorrelationIds }
) {
  try {
    const {
      detail: {
        object: { key }
      }
    } = event
    if (event['detail-type'] === 'Object Created') {
      const bucket =
        process.env[
          `${key.startsWith('temp/~/') ? 'PROTECTED_' : ''}MEDIA_BUCKET`
        ]
      const head = await s3.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key
        }),
        {
          abortSignal
        }
      )

      const { Metadata: metadata } = head

      replaceCorrelationIds(
        Object.entries(metadata).reduce((sum, [k, v]) => {
          if (k.toLocaleLowerCase().startsWith(prefix.correlationPrefix)) {
            sum[k] = v
          }
          return sum
        }, {})
      )

      log.debug({ event }, 'object created')

      const { TagSet: tagSet = [] } = await s3.send(
        new GetObjectTaggingCommand({
          Bucket: bucket,
          Key: key
        }),
        {
          abortSignal
        }
      )

      const uploadType = metadata.uploadtype
      const uploadedPaths = []

      const tempName = path.join(
        os.tmpdir(),
        `${crypto.randomUUID()}-${metadata.key}`
      )
      const tempStream = fs.createWriteStream(tempName)

      const hash = crypto.createHash('sha512')

      const { Body: s3Stream } = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key
        }),
        {
          abortSignal
        }
      )

      for await (const chunk of s3Stream) {
        tempStream.write(chunk)
        hash.update(chunk)
      }

      await new Promise((resolve, reject) => {
        tempStream.on('finish', resolve)
        tempStream.on('error', reject)
        tempStream.end()
      })

      const digest = hash.end().digest('hex')

      const { ext = 'bin', mime = 'binary/octet-stream' } =
        metadata.key.includes('.')
          ? {
              ext: path.parse(metadata.key).ext.split('?')[0]?.slice(1),
              mime: head.ContentType
            }
          : (await fileTypeFromFile(tempName)) ?? {}
      const isImage = mime.startsWith('image') && !mime.includes('svg')

      const slugName = {
        MEDIA: `media-${digest}.${ext}`
      }[uploadType]

      if (!slugName) {
        log.error({ event }, new Error(`unknown uploadType ${uploadType}`))
        return {}
      }

      const newKey = `media/${metadata.protectedprefix ?? ''}${slugName}`

      await s3.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `/${bucket}/${key}`,
          Key: newKey,
          CacheControl: head?.CacheControl,
          MetadataDirective: 'REPLACE',
          ContentType: mime,
          Metadata: metadata
        }),
        {
          abortSignal
        }
      )

      uploadedPaths.push({ name: 'original', path: newKey })

      assertFailedEntries(
        await eventBridge.send(
          new PutEventsCommand({
            Entries: [
              {
                EventBusName: process.env.EVENTBRIDGE_BUS_NAME,
                Source: 'upload',
                DetailType: 'ready',
                Detail: JSON.stringify({
                  s3Key: key,
                  files: uploadedPaths
                })
              }
            ]
          }),
          {
            abortSignal
          }
        )
      )

      if (isImage) {
        for await (const batch of resize({
          bucket,
          slugName,
          metadata,
          tempName
        })) {
          await Promise.all(
            batch.map(async function upload({ name, key, mime, output }) {
              await s3.send(
                new PutObjectCommand({
                  Bucket: bucket,
                  Body: fs.createReadStream(output),
                  Key: key,
                  ContentType: mime,
                  CacheControl: head?.CacheControl,
                  Metadata: metadata
                }),
                {
                  abortSignal
                }
              )
              await fs.promises.unlink(output)
              await s3.send(
                new PutObjectTaggingCommand({
                  Bucket: bucket,
                  Key: key,
                  Tagging: { TagSet: tagSet }
                }),
                {
                  abortSignal
                }
              )
              uploadedPaths.push({ name, path: key })
            })
          )
        }
      }

      await dynamodb.send(
        new PutCommand({
          TableName: process.env.DYNAMODB_STACK_TABLE,
          Item: {
            pk: `upload#${key}`,
            sk: `upload#${key}`,
            ttl: Math.floor((Date.now() + ms('1 hour')) / 1000),
            userId: metadata.uploadedby,
            files: uploadedPaths
          },
          ReturnValues: 'NONE'
        }),
        {
          abortSignal
        }
      )

      await Promise.all([
        fs.promises.unlink(tempName),
        eventBridge.send(
          new PutEventsCommand({
            Entries: [
              {
                EventBusName: process.env.EVENTBRIDGE_BUS_NAME,
                Source: 'upload',
                DetailType: 'ready',
                Detail: JSON.stringify({
                  s3Key: key,
                  files: uploadedPaths
                })
              }
            ]
          }),
          {
            abortSignal
          }
        )
      ])
    } else if (event['detail-type'] === 'Object Deleted') {
      log.debug({ key }, 'object deleted')
    }
    return {}
  } catch (error) {
    log.error({ event }, error)
    throw error
  }
})

async function* resize({ slugName, metadata, tempName }) {
  const sizes = [
    { name: 'x4', size: 1340 },
    { name: 'x3', size: 670 },
    { name: 'x2', size: 335 },
    { name: 'x1', size: 160 }
  ]
  const types = [
    { type: 'jpeg', mime: 'image/jpeg' },
    { type: 'webp', mime: 'image/webp' }
  ]

  for (const { type, mime } of types) {
    yield await Promise.all(
      sizes.map(async function resizeType({ name, size }) {
        const convertName = `${path.parse(slugName).name}.${type}`
        const output = path.join(
          os.tmpdir(),
          `${crypto.randomUUID()}-${convertName}`
        )
        await format(
          sharp(tempName).flatten({
            background: { r: 255, g: 255, b: 255, alpha: 1 }
          }),
          type
        )
          .resize({
            width: size,
            position: 'center'
          })
          .rotate()
          .toFile(output)

        const key = `media/${
          metadata.protectedprefix ?? ''
        }${name}/${convertName}`
        return { name, key, mime, output }
      })
    )
  }
}

function format(sharpInstance, type) {
  return sharpInstance[type]({ quality: 65, progressive: true })
}
