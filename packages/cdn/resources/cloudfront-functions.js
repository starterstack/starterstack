'use strict'

const settings = require('../../settings')
const request = require('./cloudfront-viewer-request')
const response = require('./cloudfront-viewer-response')
module.exports = async function getHandlers({ options: { stage } }) {
  if (process.argv.slice(2)[0] === 'remove' || process.env.IS_REMOVE) {
    return {
      request: '',
      response: ''
    }
  }

  const { productionStage, stackName, stackRegion, stageRoot } = settings({
    options: { stage }
  })
  return {
    request: await request({ stackName, stackRegion, stageRoot, stage }),
    response: await response({ productionStage })
  }
}
