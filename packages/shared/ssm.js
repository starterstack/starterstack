// @ts-check
import process from 'node:process'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import AWSXRay from 'aws-xray-sdk-core'
/**
 * @typedef {import('@aws-sdk/client-ssm').Parameter} SSMParameter
 * @typedef {Object<string, {
 *   ttl: number,
 *   value: {
 *     Parameter: SSMParameter
 *   }
 * }>} Cache
 *
 * @typedef {Object<string, {
 *   value: string
 *   version: number
 * }>} Parameters
 */

/**
 * @type {Cache}
 */
const cache = {}

const TTL_10_MINUTES = 60 * 1000 * 10

/** @type SSMClient */
const ssm = trace(
  new SSMClient({
    ...(process.env.IS_OFFLINE && {
      endpoint: 'http://localhost:5012',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'x',
        secretAccessKey: 'x'
      }
    })
  })
)

/**
 * @type {{
 *   cache: Cache,
 *   clearCache: () => void,
 *   get: function({name?: string, names?: string[], abortSignal: AbortSignal }): Promise<Parameters>
 * }}
 */
export default {
  cache,
  clearCache() {
    for (const key of Object.keys(cache)) {
      delete cache[key]
    }
  },
  async get({ name, names, abortSignal }) {
    /** @type {string[]} */
    const parameterNames = names ?? (name ? [name] : [])
    if (parameterNames.length === 0) {
      throw new Error('no name or names given')
    }
    const parameters = await Promise.all(
      parameterNames.map(async function fetchParameter(name) {
        const cached = cache[name]
        if (cached && cached.ttl - Date.now() > 0) {
          return cached.value
        }
        const value = await ssm.send(
          new GetParameterCommand({
            Name: name,
            WithDecryption: true
          }),
          // @ts-ignore
          { abortSignal }
        )

        if (value.Parameter) {
          cache[name] = {
            ttl: Date.now() + TTL_10_MINUTES,
            value: { Parameter: value.Parameter }
          }
        }
        return value
      })
    )

    return parameters.filter(Boolean).reduce(function reduceParameters(
      /** @type {Parameters} */
      sum,
      { Parameter: { Name: name, Value: value, Version: version } = {} }
    ) {
      if (name && value !== undefined && version !== undefined) {
        sum[name] = {
          value,
          version
        }
      }
      return sum
    }, {})
  }
}

function trace(/** @type any */ client) {
  return process.env.LAMBDA_TASK_ROOT && process.env.AWS_EXECUTION_ENV
    ? AWSXRay.captureAWSv3Client(client)
    : client
}
