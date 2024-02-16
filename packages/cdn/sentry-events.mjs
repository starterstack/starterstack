#!/usr/bin/env node

// @ts-check

import { getConfig } from '../stack-stage-config.mjs'

/** @type {import('@starterstack/sam-expand/plugins').Lifecycles} */
export const lifecycles = ['pre:expand']

/** @type {import('@starterstack/sam-expand/plugins').Plugin} */
export const lifecycle = async function sentryFunctionEvents({
  template,
  argvReader,
  command
}) {
  if (command !== 'build') {
    return
  }
  const sentryFunction = template.Resources?.SentryFunction

  if (!sentryFunction) {
    throw new TypeError('SentryFunction not found in template.Resources')
  }

  if (!template.Resources.ApiGatewayRestLogGroup) {
    throw new TypeError(
      'ApiGatewayRestLogGroup not found in template.Resources'
    )
  }

  if (!template.Resources.ApiGatewayRestApiWafLogGroup) {
    throw new TypeError(
      'ApiGatewayRestApiWafLogGroup not found in template.Resources'
    )
  }

  const stage = argvReader('Stage', { parameter: true })
  if (!stage) {
    throw new TypeError('missing stage')
  }
  const config = await getConfig({ stage, template })
  const account = template.Mappings?.AWSAccounts?.[config.accountId]
  if (!account) {
    throw new TypeError('missing account mappings')
  }
  sentryFunction.Events = {
    ApiGatewayTrigger: {
      Type: 'CloudWatchLogs',
      Properties: {
        LogGroupName: { Ref: 'ApiGatewayRestLogGroup' },
        FilterPattern:
          '{$.status > 399 && $.status != 403 && $.resourcePath != "*sentry-tunnel*" }'
      }
    },
    ...(account.wafEnabled && {
      ApiGatewayWAFTrigger: {
        Type: 'CloudWatchLogs',
        Properties: {
          LogGroupName: { Ref: 'ApiGatewayRestApiWafLogGroup' },
          FilterPattern: '{$.httpRequest.uri != "*sentry-tunnel*"}'
        }
      }
    })
  }
}
