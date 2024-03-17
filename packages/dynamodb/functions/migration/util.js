import { readFile } from 'node:fs/promises'
import crypto from 'node:crypto'
import createLambdaClient from './lambda.js'
import { InvokeCommand } from '@aws-sdk/client-lambda'
import mime from 'mime'
import path from 'node:path'

export async function uploadFile({
  id,
  fileName,
  originalUrl,
  blobPath,
  stackName,
  stage,
  abortSignal,
  uploadType,
  uploadedBy,
  visibility
}) {
  const lambda = createLambdaClient({})
  const contentType = mime.getType(fileName)
  const { Payload: response } = await lambda.send(
    new InvokeCommand({
      FunctionName: `${stackName}-media-${stage}-create-presigned-post`,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Qualifier: '$LATEST',
      Payload: JSON.stringify({
        args: {
          key: fileName,
          ...(id && { id }),
          contentType,
          uploadType,
          ...(originalUrl && { originalUrl }),
          visibility
        },
        context: {
          id: uploadedBy ?? 'migrations',
          aud: 'user'
        }
      })
    }),
    {
      abortSignal
    }
  )

  const {
    value: { url, fields }
  } = JSON.parse(new TextDecoder('utf8').decode(response))

  const form = new FormData()
  for (const { name, value } of fields) {
    form.append(name, value)
  }

  const file = new Blob([await readFile(path.join(blobPath, fileName))], {
    type: contentType
  })
  form.append('file', file)
  const upload = await fetch(url, {
    method: 'POST',
    body: form
  })

  if (upload.status !== 204) {
    throw new Error(`failed to upload login-jpg, got status ${upload.status}`)
  }
}

export async function fileHash({ blobPath, fileName }) {
  return crypto
    .createHash('sha512')
    .update(await readFile(path.join(blobPath, fileName)))
    .digest('hex')
}
