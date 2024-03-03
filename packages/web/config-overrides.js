// eslint-disable-next-line
'use strict'

const process = require('node:process')
const { override } = require('customize-cra')
const CspHtmlWebpackPlugin = require('csp-html-webpack-plugin')

const { STACK_REGION } = process.env

const cspConfigPolicy = {
  'upgrade-insecure-requests': [],
  'script-src': ["'self'"],
  'base-uri': ["'self'"],
  'connect-src': ["'self'", `https://s3.${STACK_REGION}.amazonaws.com`],
  'img-src': ["'self'", 'data:'],
  'manifest-src': ["'self'"],
  'font-src': ["'self'"],
  'media-src': ["'self'"],
  'worker-src': ["'self'"],
  'form-action': ["'self'", `https://s3.${STACK_REGION}.amazonaws.com`],
  'frame-ancestors': ["'self'"],
  'child-src': ["'none'"],
  'default-src': ["'none'"],
  'object-src': ["'none'"]
}

module.exports = override((config) => {
  if (process.env.NODE_ENV === 'production') {
    config.plugins.push(new CspHtmlWebpackPlugin(cspConfigPolicy))
  }
  return config
})
