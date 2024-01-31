'use strict'

module.exports = async function response({ productionStage }) {
  return `function handler (event) {
  var response = event.response
  var request = event.request
  var headers = response.headers
  var start = parseInt((request.headers['x-now'] || { value: '0' }).value, 10)
  if (start) {
    var timing = (headers['server-timing'] || { value: '' }).value
    var took = Date.now() - start
    if (timing) timing += ','
    headers['server-timing'] = { value: timing + 'origin;dur=' + took }
  }

  ${
    !productionStage
      ? `
  headers['x-cf-res'] = { value: JSON.stringify(event) }
  `
      : ''
  }

  if (headers['x-amz-meta-csp']) {
    var s3Csp = headers['x-amz-meta-csp'].value
    headers['content-security-policy'] = {
      value: s3Csp.startsWith('=?utf-8?b?')
        ? String.bytesFrom(s3Csp.slice(10, -2), 'base64')
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
}`
}
