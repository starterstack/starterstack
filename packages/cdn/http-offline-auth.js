'use strict'

const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda')
const Boom = require('@hapi/boom')
const { stackName } = require('../settings')()

const lambda = new LambdaClient({
  endpoint: 'http://localhost:4010',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'x',
    secretAccessKey: 'x'
  }
})

module.exports = (endpoint, functionKey, method, path) => {
  const name = `auth-${functionKey}-${path}-${method}`
  const scheme = `auth-${functionKey}-${path}-${method}`

  return {
    name,
    scheme,
    getAuthenticateFunction: () => ({
      async authenticate(request, h) {
        if (endpoint.authorizer) {
          const isHttpApi = !!endpoint.authorizer.id
          const isRestApi = !isHttpApi
          const isPublicRestApi =
            isRestApi &&
            endpoint.authorizer.authorizerId.includes('RestApiPublic')

          const bearerToken =
            isPublicRestApi &&
            (Object.entries(request.headers).find(
              ([key, value]) => key.toLowerCase() === 'authorization'
            ) || [])[1]?.match(/Bearer (.+)$/)?.[1]

          const searchToken = new URL(request.url).searchParams.get('token')
          const cookieToken = bearerToken
            ? `token=${bearerToken}`
            : searchToken
            ? `token=${searchToken}`
            : (Object.entries(request.headers).find(
                ([key, value]) => key.toLowerCase() === 'cookie'
              ) || [])[1]?.match(/token=[^;]+/)?.[0]

          const xApi = (Object.entries(request.headers).find(
            ([key, value]) => key.toLowerCase() === 'x-api'
          ) || [])[1]

          const { Payload: response } = await lambda.send(
            new InvokeCommand({
              FunctionName: `${stackName}-cdn-local-${
                endpoint.authorizer.id === '.apigwHttpApiAuthorizer}' ||
                endpoint.authorizer.authorizerId ===
                  '.apigwRestApiAuthorizer}' ||
                endpoint.authorizer.authorizerId ===
                  '.apigwRestApiPublicAuthorizer}'
                  ? 'httpAuth'
                  : 'httpAnonymousAuth'
              }`,
              InvocationType: 'RequestResponse',
              LogType: 'None',
              Qualifier: '$LATEST',
              Payload: JSON.stringify(
                isHttpApi
                  ? {
                      cookies: [cookieToken],
                      routeArn: `arn:aws:execute-api:us-east-1:000000000000:xxxxxxxxxx/$default/${request.method}/${request.url}`
                    }
                  : {
                      multiValueHeaders: {
                        cookie: [cookieToken],
                        ...(xApi && { 'x-api': [xApi], 'x-api-key': ['local'] })
                      },
                      methodArn: `arn:aws:execute-api:us-east-1:000000000000:xxxxxxxxxx/$default/${request.method}/${request.url}`
                    }
              )
            })
          )
          const policyResponse = JSON.parse(
            new TextDecoder('utf-8').decode(response)
          )

          if (policyResponse.policyDocument.Statement[0].Effect !== 'Allow') {
            throw new Boom.forbidden() // eslint-disable-line
          } else {
            return h.authenticated({
              credentials: {
                context: {
                  ...(isHttpApi && { ...policyResponse.context }),
                  ...(isRestApi && { ...policyResponse.context })
                }
              }
            })
          }
        } else {
          return h.authenticated({
            credentials: {}
          })
        }
      }
    })
  }
}
