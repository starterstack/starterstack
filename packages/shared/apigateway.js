// @ts-check
import process from 'node:process'
import { Buffer } from 'node:buffer'
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  DeleteConnectionCommand
} from '@aws-sdk/client-apigatewaymanagementapi'

import AWSXRay from 'aws-xray-sdk-core'

/**
 @type Record<string, ApiGatewayManagementApiClient>
*/
const clients = {}

/**
 @param {{
   connectionId: string,
   domainName: string,
   stage: string,
   abortSignal: AbortSignal
 }} options
 @returns ApiGatewayManagementApiClient
*/
export function createApiGatewayManagementApi({
  connectionId,
  domainName,
  stage,
  abortSignal
}) {
  const endpoint = process.env.IS_OFFLINE
    ? 'http://localhost:5003'
    : `https://${domainName}/${stage}`
  if (!clients[endpoint]) {
    clients[endpoint] = trace(
      new ApiGatewayManagementApiClient({
        apiVersion: '2018-11-29',
        endpoint,
        ...(process.env.IS_OFFLINE && {
          credentials: {
            accessKeyId: 'x',
            secretAccessKey: 'x'
          },
          region: 'us-east-1'
        })
      })
    )
  }

  const apigatewaymanagementapi = clients[endpoint]

  return {
    /** @param {string | Buffer} data */
    async postToConnection(data) {
      return await apigatewaymanagementapi.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.isBuffer(data) ? data.toString() : JSON.stringify(data)
        }),
        {
          abortSignal
        }
      )
    },
    async deleteConnection() {
      try {
        return await apigatewaymanagementapi.send(
          new DeleteConnectionCommand({
            ConnectionId: connectionId
          }),
          {
            abortSignal
          }
        )
      } /* eslint-disable no-empty */ catch {}
    }
  }
}

function trace(/** @type any */ client) {
  return process.env.LAMBDA_TASK_ROOT && process.env.AWS_EXECUTION_ENV
    ? AWSXRay.captureAWSv3Client(client)
    : client
}
