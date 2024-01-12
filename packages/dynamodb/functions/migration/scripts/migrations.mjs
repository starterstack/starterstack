import { createRequire } from 'node:module'
import { InvokeCommand } from '@aws-sdk/client-lambda'
import createLambdaClient from '../../../../shared/lambda.js'
import { setTimeout } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const { stackName } = require('../../../../settings.js')({
  options: { stage: 'local' }
})

const lambda = createLambdaClient({
  endpoint: 'http://localhost:4004',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'x',
    secretAccessKey: 'x'
  }
})

while (true) {
  try {
    const {
      StatusCode: statusCode,
      Payload: payload,
      FunctionError: functionError
    } = await lambda.send(
      new InvokeCommand({
        FunctionName: `${stackName}-dynamodb-local-migration`,
        InvocationType: 'RequestResponse',
        LogType: 'None',
        Qualifier: '$LATEST'
      })
    )
    const response = JSON.parse(new TextDecoder('utf-8').decode(payload))

    if (functionError || statusCode !== 200) {
      console.error(JSON.stringify({ statusCode, response }, null, 2))
    }

    break
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      await setTimeout(1000)
    } else {
      throw error
    }
  }
}
