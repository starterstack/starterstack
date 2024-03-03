const stage = '${Stage}'

// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
async function handler(event) {
  const response = event.response
  const request = event.request
  const headers = response.headers
  const start = Number.parseInt(
    (request.headers['x-now'] || { value: '0' }).value,
    10
  )
  if (start) {
    let timing = (headers['server-timing'] || { value: '' }).value
    const took = Date.now() - start
    if (timing) timing += ','
    headers['server-timing'] = { value: timing + 'origin;dur=' + took }
  }

  if (stage !== 'prod') {
    headers['x-cf-res'] = { value: JSON.stringify(event) }
  }

  if (headers['x-amz-meta-csp']) {
    const s3Csp = headers['x-amz-meta-csp'].value
    headers['content-security-policy'] = {
      value: s3Csp.startsWith('=?utf-8?b?')
        ? Buffer.from(s3Csp.slice(10, -2), 'base64').toString('utf8')
        : s3Csp
    }
  }


   Object.keys(headers)
    .filter(
      (key) => key.startsWith('x-amz-meta-') || key === 'x-amz-storage-class'
    )
    .forEach((key) => {
      delete headers[key]
    })

  return response
}
