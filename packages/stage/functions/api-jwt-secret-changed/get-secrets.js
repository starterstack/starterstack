import {
  SSMClient,
  GetParameterCommand,
  ParameterNotFound,
  ParameterVersionNotFound
} from '@aws-sdk/client-ssm'

import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'
import trace from './trace.js'

const { SSM_API_JWT_SECRET } = process.env

const ssm = trace(new SSMClient())

/**
 * @param {AbortSignal} abortSignal
 * @returns {Promise<{ anonymousTokenString: string, apiSecrets: Record<string, string>}>}
 */
export default async function getSecrets(abortSignal) {
  const apiSecrets = await getApiSecrets(abortSignal)

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

  return {
    anonymousTokenString,
    apiSecrets
  }
}

/**
 * @param {AbortSignal} abortSignal
 * @returns {Promise<Record<string, string>>}
 */
async function getApiSecrets(abortSignal) {
  async function getSecret(version) {
    if (typeof version === 'number' && version < 1) return
    try {
      const { Parameter: parameter } = await ssm.send(
        new GetParameterCommand({
          Name: `${SSM_API_JWT_SECRET}${version ? `:${version}` : ''}`,
          WithDecryption: true
        }),
        {
          abortSignal
        }
      )
      return parameter
    } catch (error) {
      if (
        !(error instanceof ParameterVersionNotFound) &&
        !(error instanceof ParameterNotFound)
      ) {
        throw error
      }
    }
  }

  const latestSecret = await getSecret()

  const oldSecrets = await Promise.all(
    [latestSecret?.Version - 1, latestSecret?.Version - 2].map((version) =>
      getSecret(version)
    )
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
