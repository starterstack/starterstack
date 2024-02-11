import https from 'node:https'
import {
  PutEmailIdentityMailFromAttributesCommand,
  CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand,
  DeleteConfigurationSetEventDestinationCommand,
  DeleteConfigurationSetCommand,
  DeleteEmailIdentityCommand,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  NotFoundException
} from '@aws-sdk/client-sesv2'
import {
  DescribeActiveReceiptRuleSetCommand,
  CreateReceiptRuleSetCommand,
  SetActiveReceiptRuleSetCommand,
  AlreadyExistsException
} from '@aws-sdk/client-ses'
import { ChangeResourceRecordSetsCommand } from '@aws-sdk/client-route-53'

import lambdaHandler from './lambda-handler.js'
import ses from './ses.js'
import sesv2 from './ses-v2.js'
import route53 from './route-53.js'

export const handler = lambdaHandler(async function verifySes(
  event,
  context,
  { log, abortSignal }
) {
  log.debug({ event }, 'received')

  try {
    const {
      RequestType: requestType,
      ResponseURL,
      StackId,
      RequestId,
      LogicalResourceId,
      PhysicalResourceId = context.logStreamName,
      ResourceProperties: {
        ZoneId: zoneId,
        StackName: stackName,
        Domain: domain,
        Region: region,
        ConfigurationSet: configurationSet,
        SnsDestinationTopicArn: snsDestinationTopicArn,
        RuleSet: ruleSet,
        Stage: stage
      },
      OldResourceProperties: {
        ZoneId: oldZoneId,
        StackName: oldStackName,
        Domain: oldDomain,
        Region: oldRegion,
        Stage: oldStage,
        ConfigurationSet: oldConfigurationSet,
        SnsDestinationTopicArn: oldSnsDestinationTopicArn
      } = {},
      ResourceType
    } = event

    const deleteNeeded =
      requestType === 'Update' &&
      (oldZoneId !== zoneId ||
        oldDomain !== domain ||
        oldStackName !== stackName ||
        oldRegion !== region ||
        oldStage !== stage ||
        oldConfigurationSet !== configurationSet ||
        oldSnsDestinationTopicArn !== snsDestinationTopicArn)

    const deleteError =
      deleteNeeded &&
      (await update({
        zoneId: oldZoneId,
        domain: oldDomain,
        stackName: oldStackName,
        region: oldRegion,
        stage: oldStage,
        configurationSet: oldConfigurationSet,
        snsDestinationTopicArn: oldSnsDestinationTopicArn,
        requestType: 'Delete',
        abortSignal,
        log
      }))

    const error =
      deleteError ||
      (await update({
        zoneId,
        domain,
        stackName,
        region,
        stage,
        configurationSet,
        snsDestinationTopicArn,
        ruleSet,
        requestType: deleteNeeded ? 'Create' : requestType,
        abortSignal,
        log
      }))

    const body = JSON.stringify({
      Status: error ? 'FAILED' : 'SUCCESS',
      Reason: `See the details in CloudWatch Log Stream: ${
        context.logStreamName
      }${error ? error.stack : ''}`,
      PhysicalResourceId,
      StackId,
      RequestId,
      LogicalResourceId,
      NoEcho: false,
      Data: {
        ResourceType,
        ConfigurationSet: configurationSet,
        RuleSet: ruleSet
      }
    })
    await new Promise((resolve, reject) => {
      const request = https.request(
        ResponseURL,
        {
          method: 'PUT',
          headers: {
            'Content-Type': '',
            'Content-Length': body.length
          }
        },
        (res) => {
          res.once('end', resolve)
          res.once('error', reject)
          if (
            res.statusCode &&
            (res.statusCode < 200 || res.statusCode > 299)
          ) {
            reject(new Error(`failed to fetch ${res.statusCode}`))
          }
        }
      )
      request.once('error', reject)
      request.write(body)
      request.end()
    })
  } catch (error) {
    log.error({ event }, error)
    throw error
  }
})

async function update({
  zoneId,
  domain,
  stackName,
  region,
  stage,
  configurationSet,
  snsDestinationTopicArn,
  ruleSet,
  requestType,
  abortSignal,
  log
}) {
  try {
    if (!domain) throw new TypeError('missing Domain')
    if (!zoneId) throw new TypeError('missing ZoneId')
    if (!region) throw new TypeError('missing Region')
    if (!configurationSet) throw new TypeError('missing ConfigurationSet')
    if (!requestType) throw new TypeError('missing RequestType')

    const activeRuleSet = await ses.send(
      new DescribeActiveReceiptRuleSetCommand(),
      { abortSignal }
    )
    const activeRuleSetExists =
      activeRuleSet.Metadata && activeRuleSet.Metadata.Name === ruleSet

    if (
      (requestType === 'Create' || requestType === 'Update') &&
      !activeRuleSetExists
    ) {
      try {
        await ses.send(
          new CreateReceiptRuleSetCommand({
            RuleSetName: ruleSet
          }),
          {
            abortSignal
          }
        )
      } catch (error) {
        if (!(error instanceof AlreadyExistsException)) {
          throw error
        }
      }
      try {
        await ses.send(
          new SetActiveReceiptRuleSetCommand({
            RuleSetName: ruleSet
          }),
          {
            abortSignal
          }
        )
      } catch (error) {
        if (!(error instanceof AlreadyExistsException)) {
          throw error
        }
      }
    }

    if (requestType === 'Create') {
      await sesv2.send(
        new CreateConfigurationSetCommand({
          ConfigurationSetName: configurationSet,
          DeliveryOptions: {
            SendingPoolName: 'ses-shared-pool',
            TlsPolicy: 'REQUIRE'
          },
          SuppressionOptions: {
            SuppressedReasons: ['COMPLAINT', 'BOUNCE']
          },
          ReputationOptions: {
            ReputationMetricsEnabled: true
          },
          SendingOptions: { SendingEnabled: true },
          Tags: [
            { Key: 'Name', Value: configurationSet },
            { Key: 'ManagedBy', Value: stackName },
            stage && { Key: 'STAGE', Value: stage }
          ].filter(Boolean)
        }),
        {
          abortSignal
        }
      )

      if (snsDestinationTopicArn) {
        await sesv2.send(
          new CreateConfigurationSetEventDestinationCommand({
            ConfigurationSetName: configurationSet,
            EventDestination: {
              Enabled: true,
              MatchingEventTypes: [
                'SEND',
                'REJECT',
                'BOUNCE',
                'COMPLAINT',
                'DELIVERY',
                'OPEN',
                'CLICK',
                'RENDERING_FAILURE',
                'DELIVERY_DELAY',
                'SUBSCRIPTION'
              ],
              SnsDestination: {
                TopicArn: snsDestinationTopicArn
              }
            },
            EventDestinationName: `${configurationSet}-event-destination-sns`
          }),
          {
            abortSignal
          }
        )
      }

      await sesv2.send(
        new CreateConfigurationSetEventDestinationCommand({
          ConfigurationSetName: configurationSet,
          EventDestination: {
            Enabled: true,
            CloudWatchDestination: {
              DimensionConfigurations: [
                {
                  DimensionValueSource: 'MESSAGE_TAG',
                  DefaultDimensionValue: 'Null',
                  DimensionName: `${configurationSet}-ses-tracking`
                }
              ]
            },
            MatchingEventTypes: [
              'SEND',
              'REJECT',
              'BOUNCE',
              'COMPLAINT',
              'DELIVERY',
              'OPEN',
              'CLICK',
              'RENDERING_FAILURE',
              'DELIVERY_DELAY',
              'SUBSCRIPTION'
            ]
          },
          EventDestinationName: `${configurationSet}-event-destination-cloud-watch`
        }),
        {
          abortSignal
        }
      )
    }

    const dkimTokens = await upsertDkimTokens({
      domain,
      stackName,
      stage,
      ses: sesv2,
      configurationSet,
      requestType,
      abortSignal
    })

    if (requestType !== 'Delete') {
      await sesv2.send(
        new PutEmailIdentityMailFromAttributesCommand({
          EmailIdentity: domain,
          MailFromDomain: `mail.${domain}`
        }),
        {
          abortSignal
        }
      )
    }
    const route53Action = requestType === 'Delete' ? 'DELETE' : 'UPSERT'

    const route53Changes = [
      ...dkimTokens.map((token) => {
        return {
          Action: route53Action,
          ResourceRecordSet: {
            Name: `${token}._domainkey.${domain}`,
            ResourceRecords: [{ Value: `${token}.dkim.amazonses.com` }],
            TTL: 300,
            Type: 'CNAME'
          }
        }
      }),
      {
        Action: route53Action,
        ResourceRecordSet: {
          Name: `${domain}.`,
          ResourceRecords: [
            { Value: `10 inbound-smtp.${region}.amazonaws.com` }
          ],
          TTL: 300,
          Type: 'MX'
        }
      },
      {
        Action: route53Action,
        ResourceRecordSet: {
          Name: `mail.${domain}.`,
          ResourceRecords: [
            { Value: `10 feedback-smtp.${region}.amazonses.com` }
          ],
          TTL: 300,
          Type: 'MX'
        }
      },
      {
        Action: route53Action,
        ResourceRecordSet: {
          Name: `mail.${domain}.`,
          ResourceRecords: [{ Value: '"v=spf1 include:amazonses.com ~all"' }],
          TTL: 300,
          Type: 'TXT'
        }
      }
    ]

    await route53.send(
      new ChangeResourceRecordSetsCommand({
        HostedZoneId: zoneId,
        ChangeBatch: {
          Changes: route53Changes
        }
      }),
      {
        abortSignal
      }
    )

    if (requestType === 'Delete') {
      if (snsDestinationTopicArn) {
        try {
          await sesv2.send(
            new DeleteConfigurationSetEventDestinationCommand({
              ConfigurationSetName: configurationSet,
              EventDestinationName: `${configurationSet}-event-destination-sns`
            }),
            {
              abortSignal
            }
          )
        } catch (error) {
          if (!(error instanceof NotFoundException)) {
            throw error
          }
        }
      }
      try {
        await sesv2.send(
          new DeleteConfigurationSetEventDestinationCommand({
            ConfigurationSetName: configurationSet,
            EventDestinationName: `${configurationSet}-event-destination-cloud-watch`
          }),
          {
            abortSignal
          }
        )
      } catch (error) {
        if (!(error instanceof NotFoundException)) {
          throw error
        }
      }
      try {
        await sesv2.send(
          new DeleteConfigurationSetCommand({
            ConfigurationSetName: configurationSet
          }),
          {
            abortSignal
          }
        )
      } catch (error) {
        if (!(error instanceof NotFoundException)) {
          throw error
        }
      }
      try {
        await sesv2.send(
          new DeleteEmailIdentityCommand({ EmailIdentity: domain }),
          {
            abortSignal
          }
        )
      } catch (error) {
        if (!(error instanceof NotFoundException)) {
          throw error
        }
      }
    }
  } catch (error) {
    log.error(error)
    return error
  }
}

async function upsertDkimTokens({
  ses,
  domain,
  stackName,
  stage,
  configurationSet,
  requestType,
  abortSignal
}) {
  const {
    DkimAttributes: { Tokens: dkimTokens }
  } =
    requestType === 'Create'
      ? await ses.send(
          new CreateEmailIdentityCommand({
            EmailIdentity: domain,
            ConfigurationSetName: configurationSet,
            Tags: [
              { Key: 'Name', Value: domain },
              { Key: 'ManagedBy', Value: stackName },
              stage && { Key: 'STAGE', Value: stage }
            ].filter(Boolean)
          }),
          {
            abortSignal
          }
        )
      : await ses.send(
          new GetEmailIdentityCommand({
            EmailIdentity: domain
          }),
          {
            abortSignal
          }
        )

  return dkimTokens
}
