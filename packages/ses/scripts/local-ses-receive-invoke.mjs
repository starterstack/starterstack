import process from 'node:process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import s3 from '../../shared/s3.js'

const lambda = new LambdaClient({
  endpoint: 'http://localhost:4007',
  region: 'eu-west-1',
  credentials: {
    accessKeyId: 'x',
    secretAccessKey: 'x'
  }
})
const id = 'media/' + crypto.randomUUID()
const json = {
  Records: [
    {
      ses: {
        mail: {
          messageId: id,
          source: 'test@localhost'
        }
      }
    }
  ]
}
await s3.send(
  new PutObjectCommand({
    Bucket: 'media',
    Key: id,
    Body: fs.createReadStream('./email.eml')
  })
)

await lambda.send(
  new InvokeCommand({
    FunctionName: process.env.STACK_NAME + '-ses-local-ses-receive',
    InvocationType: 'Event',
    LogType: 'None',
    Qualifier: '$LATEST',
    Payload: JSON.stringify(json)
  })
)

console.log('saved')

for (const file of ['README.md', 'package.json', 'LICENSE']) {
  console.log('http://localhost:5001/' + id + '/' + file)
}
