import process from 'node:process'
import nodeHttp from 'node:http'
import nodeHttps from 'node:https'
import AWSXRay from 'aws-xray-sdk-core'

const capture = process.env.LAMBDA_TASK_ROOT && process.env.AWS_EXECUTION_ENV

if (capture) {
  traceHttp(nodeHttp)
  traceHttp(nodeHttps)
  traceFetch()
}

function traceHttp(http) {
  AWSXRay.captureHTTPsGlobal(http)
}

// reverse engineered from https://github.com/aws/aws-xray-sdk-node/blob/93a4f31de2974c10b25ec317bfadd07aabcc9015/packages/core/lib/patchers/http_p.js
// we don't need to take care of manual mode

function traceFetch() {
  const fetch = globalThis.fetch
  globalThis.fetch = async function (resource, options) {
    const traceHeader =
      resource.headers?.get('X-Amzn-Trace-Id') ?? options?.['X-Amzn-Trace-Id']

    if (!traceHeader) {
      const parent = AWSXRay.resolveSegment()

      if (parent) {
        const url = resource?.url ?? resource
        const method = resource?.method ?? options?.method ?? 'GET'
        const { hostname } = new URL(url)
        const subsegment = parent.notTraced
          ? parent.addNewSubsegmentWithoutSampling(hostname)
          : parent.addNewSubsegment(hostname)
        const root = parent.segment ? parent.segment : parent
        subsegment.namespace = 'remote'

        if (!options) {
          options = {}
        }

        if (!options.headers) {
          options.headers = {}
        }

        options.headers['X-Amzn-Trace-Id'] =
          'Root=' +
          root.trace_id +
          ';Parent=' +
          subsegment.id +
          ';Sampled=' +
          (subsegment.notTraced ? '0' : '1')

        subsegment.http = {
          request: {
            url,
            method
          }
        }

        try {
          const res = await fetch.call(globalThis, resource, options)
          if (res.status === 429) {
            subsegment.addThrottleFlag()
          } else if (!res.ok) {
            subsegment.addErrorFlag()
          }
          const cause = AWSXRay.utils.getCauseTypeFromHttpStatus(res.status)
          if (cause) {
            subsegment[cause] = true
          }
          const contentLength = res.headers.get('content-length')
          subsegment.http.response = {
            status: res.status,
            ...(contentLength && { content_length: contentLength })
          }
          subsegment.close()
          return res
        } catch (error) {
          subsegment.close(error)
          throw error
        }
      }
    }

    return await fetch.call(globalThis, resource, options)
  }
}
