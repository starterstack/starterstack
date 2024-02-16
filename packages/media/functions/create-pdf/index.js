import process from 'node:process'
import lambdaHandler from './lambda-handler.js'
import s3 from './s3.js'
import {
  PutObjectTaggingCommand,
  GetObjectCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3'
import ApplicationError from './application-error.js'
import * as pdf from './pdf.js'

import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import crypto from 'node:crypto'
import template from './template.js'
import data from './data.js'
import images from './images.js'

export const handler = lambdaHandler(async function createPdf(
  event,
  context,
  { log, abortSignal, correlationIds }
) {
  log.debug({ event }, 'received')

  try {
    const document = await pdf.createPdf({
      stackName: process.env.STACK,
      template,
      data,
      images,
      correlationIds
    })

    const pdfKey = `pdf/${crypto.randomUUID()}.pdf`

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.PROTECTED_MEDIA_BUCKET,
        Body: await document.save(),
        Key: pdfKey,
        ContentType: 'application/pdf',
        ContentDisposition: 'attachment; filename=fake-invoice.pdf'
      }),
      {
        abortSignal
      }
    )

    await s3.send(
      new PutObjectTaggingCommand({
        Bucket: process.env.PROTECTED_MEDIA_BUCKET,
        Key: pdfKey,
        Tagging: { TagSet: [{ Key: 'ManagedBy', Value: process.env.STACK }] }
      }),
      {
        abortSignal
      }
    )

    return {
      value: await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: process.env.PROTECTED_MEDIA_BUCKET,
          Key: pdfKey
        }),
        { expiresIn: 300 }
      )
    }
  } catch (error) {
    log.error({ event }, error)
    if (error instanceof ApplicationError) {
      return {
        applicationError: error
      }
    } else {
      throw error
    }
  }
})
