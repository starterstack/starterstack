import process from 'node:process'
import { Buffer } from 'node:buffer'
import { MailParser } from 'mailparser'
import { PutEventsCommand } from '@aws-sdk/client-eventbridge'
import {
  GetObjectCommand,
  PutObjectCommand,
  PutObjectTaggingCommand
} from '@aws-sdk/client-s3'
import { pipeline } from 'node:stream/promises'
import eventBridge, { assertFailedEntries } from './eventbridge.js'
import s3 from './s3.js'
import lambdaHandler from './lambda-handler.js'
import mime from 'mime'

const { STACK, S3_MAIL_BUCKET } = process.env

export const handler = lambdaHandler(async function sesReceive(
  event,
  _,
  { log, abortSignal }
) {
  log.debug({ event }, 'received')

  try {
    for (const {
      ses: { mail }
    } of event.Records) {
      const parser = new MailParser()
      const { Body: message } = await s3.send(
        new GetObjectCommand({
          Bucket: S3_MAIL_BUCKET,
          Key: mail.messageId
        }),
        {
          abortSignal
        }
      )

      await pipeline(
        message,
        parser,
        async function (source) {
          for await (const data of source) {
            if (data.type === 'attachment') {
              log.debug({ filename: data.filename }, 'got attachment')
              const attachment = []
              for await (const chunk of data.content) {
                attachment.push(chunk)
              }

              const contentType = mime.getType(data.filename)
              const charset =
                contentType &&
                /^(text|application\/(javascript|json))/i.test(contentType)
                  ? '; charset=UTF-8'
                  : ''

              await s3.send(
                new PutObjectCommand({
                  Bucket: S3_MAIL_BUCKET,
                  Key: `${mail.messageId}/${data.filename}`,
                  Body: Buffer.concat(attachment),
                  ...(contentType && {
                    ContentType: `${contentType}${charset}`
                  })
                }),
                {
                  abortSignal
                }
              )

              data.release()

              await s3.send(
                new PutObjectTaggingCommand({
                  Bucket: S3_MAIL_BUCKET,
                  Key: `${mail.messageId}/${data.filename}`,
                  Tagging: {
                    TagSet: [
                      {
                        Key: 'ManagedBy',
                        Value: STACK
                      }
                    ]
                  }
                }),
                {
                  abortSignal
                }
              )
            } else if (data.type === 'text') {
              log.debug(data)
            }
          }
        },
        { signal: abortSignal }
      )

      assertFailedEntries(
        await eventBridge.send(
          new PutEventsCommand({
            Entries: [
              {
                EventBusName: process.env.EVENTBRIDGE_BUS_NAME,
                Source: 'email',
                DetailType: 'hello',
                Detail: JSON.stringify({
                  email: mail.source,
                  team: process.env.TEAM
                })
              }
            ]
          }),
          {
            abortSignal
          }
        )
      )
    }

    return {}
  } catch (error) {
    log.error({ event }, error)
    throw error
  }
})
