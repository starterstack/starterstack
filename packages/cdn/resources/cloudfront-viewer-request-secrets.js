'use strict'

const {
  SSMClient,
  GetParameterCommand,
  ParameterNotFound,
  ParameterVersionNotFound
} = require('@aws-sdk/client-ssm')

const crypto = require('node:crypto')
const { Buffer } = require('node:buffer')

module.exports = async function getSecrets({ stackName, stackRegion, stage }) {
  const apiSecrets = await getApiSecrets({ stackName, stackRegion, stage })

  if (!apiSecrets.latest) {
    throw new Error('missing secret')
  }

  const anonymousTokenParts = [
    '{"alg":"HS256","typ":"JWT"}',
    `{"v": "${apiSecrets.latest}", "iat": ${Date.now() / 1000}}`
  ]
    .map((value) => Buffer.from(value).toString('base64url'))
    .join('.')

  const anonymousSignature = crypto
    .createHmac('sha256', `cf:${apiSecrets[apiSecrets.latest]}`)
    .update(anonymousTokenParts)
    .digest('base64url')

  const anonymousTokenString = anonymousTokenParts + '.' + anonymousSignature

  delete apiSecrets.latest
  const apiSecretsString = JSON.stringify(apiSecrets).replace(/"/g, "'")

  return {
    anonymousTokenString,
    apiSecretsString
  }
}

async function getApiSecrets({ stackName, stackRegion, stage }) {
  const ssm = new SSMClient({ ...(stackRegion && { region: stackRegion }) })

  const SSM_API_JWT_SECRET = `/${stackName}/${stage}/API_JWT_SECRET`

  async function getSecret(version) {
    if (typeof version === 'number' && version < 1) return
    try {
      const { Parameter: parameter } = await ssm.send(
        new GetParameterCommand({
          Name: `${SSM_API_JWT_SECRET}${version ? `:${version}` : ''}`,
          WithDecryption: true
        })
      )
      return parameter
    } catch (err) {
      if (
        !(err instanceof ParameterVersionNotFound) &&
        !(err instanceof ParameterNotFound)
      ) {
        throw err
      }
    }
  }

  const latestSecret = await getSecret()

  const oldSecrets = await Promise.all(
    [latestSecret?.Version - 1, latestSecret?.Version - 2].map(getSecret)
  )

  return [latestSecret, ...oldSecrets].reduce(
    (secrets, secret) => {
      if (secret?.Value) {
        secrets[String(secret.Version)] = secret.Value
      }
      return secrets
    },
    {
      ...(latestSecret && { latest: String(latestSecret.Version) })
    }
  )
}
