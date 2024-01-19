// @ts-check

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFile } from 'node:fs/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('@starterstack/sam-expand/plugins').Lifecycles} */
export const lifecycles = ['pre:expand']

/** @type {import('@starterstack/sam-expand/plugins').PluginSchema<{ region?: string, 'suffixStage': boolean, stage?: string, regions?: string }>} */
export const schema = {
  type: 'object',
  properties: {
    snsTopicRef: {
      type: 'string',
      nullable: false
    }
  },
  required: ['snsTopicRef'],
  additionalProperties: false
}

export const metadataConfig = 'alarms'

const { stackName } = JSON.parse(
  await readFile(path.join(__dirname, 'settings.json'), 'utf8')
)

// eslint-disable-next-line @typescript-eslint/require-await
export const lifecycle = async function generateCloudwatchAlarms({
  command,
  argv,
  template,
  lifecycle,
  log
}) {
  if (lifecycle === 'pre:expand' && command === 'build') {
    if (!template.Mappings?.AWSAccounts) {
      throw new Error('missing mappings for AWSAccounts')
    }
    const stageIndex = argv.findIndex((/** @type {string} */ x) =>
      x.startsWith('Stage=')
    )
    const stage =
      stageIndex === -1 ? '' : argv[stageIndex].slice('Stage='.length)
    if (!stage) {
      throw new TypeError('missing stage')
    }
    const regionIndex = argv.indexOf('--region')
    const region = regionIndex === -1 ? '' : argv[regionIndex + 1]
    if (!region) {
      throw new TypeError('missing region')
    }

    log('generating CloudWatch alarms', { stage, region })
    const config = template.Metadata.expand.config.alarms
    const snsAlarmTopic = { Ref: config.snsTopicRef }
    const resources = template.Resources

    for (const [logicalId, resource] of Object.entries(resources)) {
      if (
        ![
          'AWS::Lambda::Function',
          'AWS::Serverless::Function',
          'AWS::Lambda::EventSourceMapping',
          'AWS::Lambda::EventInvokeConfig',
          'AWS::SQS::Queue',
          'AWS::Scheduler::ScheduleGroup',
          'AWS::Events::Rule',
          'AWS::SNS::Subscription',
          'AWS::ApiGateway::Method',
          'AWS::ApiGatewayV2::Route',
          'AWS::DynamoDB::GlobalTable',
          'AWS::WAFv2::WebACL',
          'AWS::S3::Bucket',
          'AWS::Pipes::Pipe',
          'AWS::CertificateManager::Certificate',
          'AWS::KinesisFirehose::DeliveryStream'
        ].includes(resource.Type)
      ) {
        continue
      }
      const condition = createCondition({ resource, template })
      switch (resource.Type) {
        case 'AWS::Lambda::Function': {
          generateLambdaThrottleAlarm({
            logicalId,
            resources,
            snsAlarmTopic,
            condition,
            region
          })
          generateLambdaErrorRateAlarm({
            logicalId,
            resources,
            snsAlarmTopic,
            condition,
            region
          })

          break
        }
        case 'AWS::Serverless::Function': {
          generateLambdaThrottleAlarm({
            logicalId,
            resources,
            snsAlarmTopic,
            condition,
            region
          })
          generateLambdaErrorRateAlarm({
            logicalId,
            resources,
            snsAlarmTopic,
            condition,
            region
          })

          if (
            resource.Properties?.EventInvokeConfig &&
            resource?.Properties?.EventInvokeConfig?.DestinationConfig
              ?.OnFailure?.Target
          ) {
            generateLambdaIteratorAgeAlarm({
              logicalId,
              resources,
              snsAlarmTopic,
              condition,
              region
            })
          }

          break
        }
        case 'AWS::Lambda::EventSourceMapping': {
          const lambdaLogicalId =
            resource?.Properties?.FunctionName?.['Fn::GetAtt']?.[0]
          if (lambdaLogicalId) {
            generateLambdaIteratorAgeAlarm({
              logicalId: lambdaLogicalId,
              resources,
              snsAlarmTopic,
              condition,
              region
            })
          }

          break
        }
        case 'AWS::Lambda::EventInvokeConfig': {
          if (resource?.Properties?.DestinationConfig?.OnFailure?.Destination) {
            const lambdaLogicalId = resource?.Properties?.FunctionName?.Ref
            if (lambdaLogicalId) {
              generateLambdaDestinationDeliveryFailureAlarm({
                logicalId: lambdaLogicalId,
                resources,
                snsAlarmTopic,
                condition,
                region
              })
            }
          }

          break
        }
        case 'AWS::SQS::Queue': {
          generateSqsAgeAlarm({
            logicalId,
            resources,
            snsAlarmTopic,
            condition,
            region
          })

          break
        }
        case 'AWS::Scheduler::ScheduleGroup': {
          generateSchedulerInvocationsFailedToBeSentToDlqAlarm({
            logicalId,
            resources,
            snsAlarmTopic,
            condition,
            region
          })
          generateSchedulerThrottledAlarm({
            logicalId,
            resources,
            snsAlarmTopic,
            condition,
            region
          })

          break
        }
        case 'AWS::Events::Rule': {
          if (
            resource?.Properties?.Targets?.find(
              (target) => !!target.DeadLetterConfig
            )
          ) {
            generateEventsInvocationsFailedToBeSentToDlqAlarm({
              logicalId,
              resource,
              resources,
              snsAlarmTopic,
              condition,
              region
            })
          }
          generateEventsThrottledRulesAlarm({
            logicalId,
            resource,
            resources,
            snsAlarmTopic,
            condition,
            region
          })

          break
        }
        case 'AWS::SNS::Subscription': {
          if (resource?.Properties?.RedrivePolicy?.deadLetterTargetArn) {
            generateSnsFailedToDriveToDlqAlarm({
              logicalId,
              resource,
              resources,
              snsAlarmTopic,
              condition,
              region
            })
          }

          break
        }
        case 'AWS::ApiGateway::Method': {
          const restApiPath = getRestApiPath({
            resourceId: resource.Properties?.ResourceId,
            resources
          })
          const apiName = `${stackName}-cdn-${stage}-rest-api`
          const httpMethod = resource.Properties.HttpMethod
          generateRestApiErrorRateAlarm({
            apiName,
            httpMethod,
            restApiPath,
            resources,
            snsAlarmTopic,
            condition,
            region,
            stage
          })
          generateRestApiP90LatencyAlarm({
            apiName,
            httpMethod,
            restApiPath,
            resources,
            condition,
            region,
            stage
          })

          break
        }
        case 'AWS::ApiGatewayV2::Route': {
          const [httpMethod, httpApiPath] =
            resource.Properties.RouteKey.split(' ')

          if (httpMethod && httpApiPath) {
            const apiName = `${stackName}-cdn-${stage}-http`
            generateHttpApiErrorRateAlarm({
              apiName,
              httpMethod,
              httpApiPath,
              resource,
              resources,
              snsAlarmTopic,
              condition,
              region,
              stage
            })
            generateHttpApiP90LatencyAlarm({
              apiName,
              httpMethod,
              httpApiPath,
              resource,
              resources,
              condition,
              region
            })
          } else {
            const apiName = `${stackName}-cdn-${stage}-websocket`
            generateWebSocketErrorRateAlarm({
              apiName,
              resource,
              resources,
              snsAlarmTopic,
              condition,
              region,
              stage
            })
          }

          break
        }
        case 'AWS::DynamoDB::GlobalTable': {
          generateDynamodbThrottleAlarm({
            logicalId,
            resources,
            snsAlarmTopic,
            condition,
            region
          })
          generateDynamodbSystemErrorAlarm({
            logicalId,
            resources,
            snsAlarmTopic,
            condition,
            region
          })

          break
        }
        case 'AWS::WAFv2::WebACL': {
          generateWafAlarms({
            logicalId,
            resource,
            resources,
            snsAlarmTopic,
            condition,
            region
          })

          break
        }
        case 'AWS::S3::Bucket': {
          if (resource?.Properties?.MetricsConfigurations) {
            for (const { Id: filterId } of resource.Properties
              .MetricsConfigurations) {
              generateS3BucketRequest4xxErrorAlarm({
                filterId,
                logicalId,
                resources,
                snsAlarmTopic,
                condition,
                region
              })
              generateS3BucketRequest5xxErrorAlarm({
                filterId,
                logicalId,
                resources,
                snsAlarmTopic,
                condition,
                region
              })
            }
          }

          break
        }
        case 'AWS::Pipes::Pipe': {
          generatePipeAlarms({
            logicalId,
            resources,
            snsAlarmTopic,
            condition,
            region
          })

          break
        }
        case 'AWS::CertificateManager::Certificate': {
          generateCertificateExpiryAlarm({
            logicalId,
            resource,
            resources,
            snsAlarmTopic,
            condition,
            region
          })

          break
        }
        case 'AWS::KinesisFirehose::DeliveryStream': {
          generateKinesisFirehoseDataFreshnessErrorAlarm({
            logicalId,
            resource,
            resources,
            snsAlarmTopic,
            condition,
            region
          })
          generateKinesisFirehoseThrottleAlarm({
            logicalId,
            resources,
            snsAlarmTopic,
            condition,
            region
          })
          generateKinesisFirehoseFailedConversionAlarm({
            logicalId,
            resource,
            resources,
            snsAlarmTopic,
            condition,
            region
          })
          generateKinesisFirehoseLimitAlarms({
            logicalId,
            resources,
            snsAlarmTopic,
            condition,
            region
          })

          break
        }
        // No default
      }
    }
  }
}

function generateDynamodbThrottleAlarm({
  logicalId,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const tableName = {
    Ref: logicalId
  }
  const threshold = 0
  const evaluationPeriods = 5

  for (const throttleType of ['read', 'write']) {
    const metricName =
      throttleType === 'read' ? 'ReadThrottleEvents' : 'WriteThrottleEvents'
    const alarmName = {
      'Fn::Join': [
        '',
        [
          `${stackName} dynamodb table `,
          tableName,
          ` in ${region} ${throttleType} throttled count > ${threshold} over the last ${evaluationPeriods} mins`
        ]
      ]
    }
    resources[`${logicalId}DynamoDB${metricName}Alarm`] = {
      Type: 'AWS::CloudWatch::Alarm',
      Condition: condition,
      Properties: {
        AlarmActions: [snsAlarmTopic],
        AlarmDescription: alarmName,
        AlarmName: alarmName,
        ComparisonOperator: 'GreaterThanThreshold',
        Dimensions: [{ Name: 'TableName', Value: { Ref: logicalId } }],
        MetricName: metricName,
        Namespace: 'AWS/DynamoDB',
        Statistic: 'Sum',
        EvaluationPeriods: evaluationPeriods,
        Period: 60,
        Threshold: threshold
      }
    }
  }
}

function generateDynamodbSystemErrorAlarm({
  logicalId,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const tableName = {
    Ref: logicalId
  }
  const threshold = 0
  const evaluationPeriods = 5
  const alarmName = {
    'Fn::Join': [
      '',
      [
        `${stackName} dynamodb table `,
        tableName,
        ` in ${region} system error count > ${threshold} over the last ${evaluationPeriods} mins`
      ]
    ]
  }
  resources[`${logicalId}DynamoDBSystemErrorAlarm`] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: [{ Name: 'TableName', Value: { Ref: logicalId } }],
      MetricName: 'SystemErrors',
      Namespace: 'AWS/DynamoDB',
      Statistic: 'Sum',
      EvaluationPeriods: evaluationPeriods,
      Period: 60,
      Threshold: threshold
    }
  }
}

function generateEventsInvocationsFailedToBeSentToDlqAlarm({
  logicalId,
  resource,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 0
  const evaluationPeriods = 1
  const { Name: ruleName, EventBusName: eventBus } = resource.Properties
  const alarmName = {
    'Fn::Join': [
      '',
      [
        `${stackName} event rule `,
        ruleName,
        ` in ${region} invocations failed to be sent to dlq count > ${threshold} over the last ${evaluationPeriods} mins`
      ]
    ]
  }
  const dimensions = [{ Name: 'RuleName', Value: ruleName }]
  if (eventBus) {
    dimensions.push({ Name: 'EventBusName', Value: eventBus })
  }
  resources[`${logicalId}EventsInvocationsFailedToBeSentToDlqAlarm`] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: dimensions,
      MetricName: 'InvocationsFailedToBeSentToDlq',
      Namespace: 'AWS/Events',
      Statistic: 'Sum',
      EvaluationPeriods: evaluationPeriods,
      Period: 60,
      Threshold: threshold
    }
  }
}

function generateSchedulerInvocationsFailedToBeSentToDlqAlarm({
  logicalId,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 0
  const evaluationPeriods = 1

  const scheduleGroup = {
    Ref: logicalId
  }

  const alarmName = {
    'Fn::Join': [
      '',
      [
        `${stackName} scheduler `,
        scheduleGroup,
        ` in ${region} invocations failed to be sent to dlq count > ${threshold} over the last ${evaluationPeriods} mins`
      ]
    ]
  }

  const dimensions = [{ Name: 'ScheduleGroup', Value: scheduleGroup }]

  resources[`${logicalId}SchedulerInvocationsFailedToBeSentToDlqAlarm`] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: dimensions,
      MetricName: 'InvocationsFailedToBeSentToDeadLetterCount',
      Namespace: 'AWS/Scheduler',
      Statistic: 'Sum',
      EvaluationPeriods: evaluationPeriods,
      Period: 60,
      Threshold: threshold
    }
  }
}

function generateEventsThrottledRulesAlarm({
  logicalId,
  resource,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 0
  const evaluationPeriods = 1
  const { Name: ruleName, EventBusName: eventBus } = resource.Properties

  const alarmName = {
    'Fn::Join': [
      '',
      [
        `${stackName} event rule `,
        ruleName,
        ` in ${region} throttled count > ${threshold} over the last ${evaluationPeriods} mins`
      ]
    ]
  }
  const dimensions = [{ Name: 'RuleName', Value: ruleName }]
  if (eventBus) {
    dimensions.push({ Name: 'EventBusName', Value: eventBus })
  }
  resources[`${logicalId}EventsThrottledRulesAlarm`] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: dimensions,
      MetricName: 'ThrottledRules',
      Namespace: 'AWS/Events',
      Statistic: 'Sum',
      EvaluationPeriods: evaluationPeriods,
      Period: 60,
      Threshold: threshold
    }
  }
}

function generateSchedulerThrottledAlarm({
  logicalId,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 0
  const evaluationPeriods = 1

  const scheduleGroup = {
    Ref: logicalId
  }

  for (const metric of [
    'TargetErrorThrottledCount',
    'InvocationThrottleCount'
  ]) {
    const alarmName = {
      'Fn::Join': [
        '',
        [
          `${stackName} scheduler `,
          scheduleGroup,
          `in ${region} throttled metric ${metric} count > ${threshold} over the last ${evaluationPeriods} mins`
        ]
      ]
    }
    const dimensions = [{ Name: 'ScheduleGroup', Value: scheduleGroup }]

    resources[`${logicalId}Scheduler${metric}Alarm`] = {
      Type: 'AWS::CloudWatch::Alarm',
      Condition: condition,
      Properties: {
        AlarmActions: [snsAlarmTopic],
        AlarmDescription: alarmName,
        AlarmName: alarmName,
        ComparisonOperator: 'GreaterThanThreshold',
        Dimensions: dimensions,
        MetricName: metric,
        Namespace: 'AWS/Scheduler',
        Statistic: 'Sum',
        EvaluationPeriods: evaluationPeriods,
        Period: 60,
        Threshold: threshold
      }
    }
  }
}

function generateLambdaThrottleAlarm({
  logicalId,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 0
  const evaluationPeriods = 1

  const functionName = { Ref: logicalId }
  const alarmName = {
    'Fn::Sub': `${stackName} lambda \${${logicalId}} in ${region} throttle count > ${threshold} over the last ${evaluationPeriods} mins`
  }
  resources[`${logicalId}LambdaThrottleCountAlarm`] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: [{ Name: 'FunctionName', Value: functionName }],
      MetricName: 'Throttles',
      Namespace: 'AWS/Lambda',
      Statistic: 'Sum',
      EvaluationPeriods: evaluationPeriods,
      Period: 60,
      Threshold: threshold
    }
  }
}

function generateLambdaDestinationDeliveryFailureAlarm({
  logicalId,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 0
  const evaluationPeriods = 1
  const functionName = { Ref: logicalId }
  const alarmName = {
    'Fn::Sub': `${stackName} lambda \${${logicalId}} in ${region} destination delivery failure count > ${threshold} over the last ${evaluationPeriods} mins`
  }
  resources[`${logicalId}LambdaDestinationDeliveryFailureAlarm`] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: [{ Name: 'FunctionName', Value: functionName }],
      MetricName: 'DestinationDeliveryFailures',
      Namespace: 'AWS/Lambda',
      Statistic: 'Sum',
      EvaluationPeriods: evaluationPeriods,
      Period: 60,
      Threshold: threshold
    }
  }
}

function generateLambdaIteratorAgeAlarm({
  logicalId,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 60_000
  const evaluationPeriods = 5
  const functionName = { Ref: logicalId }
  const alarmName = {
    'Fn::Sub': `${stackName} lambda \${${logicalId}} in ${region} iterator age > ${threshold}ms over the last ${evaluationPeriods} mins`
  }
  resources[`${logicalId}LambdaIteratorAgeAlarm`] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: [{ Name: 'FunctionName', Value: functionName }],
      MetricName: 'IteratorAge',
      Namespace: 'AWS/Lambda',
      Statistic: 'Maximum',
      EvaluationPeriods: evaluationPeriods,
      Period: 60,
      Threshold: threshold,
      TreatMissingData: 'notBreaching'
    }
  }
}

function generateSqsAgeAlarm({
  logicalId,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 60
  const evaluationPeriods = 5
  const queueName = {
    'Fn::GetAtt': [logicalId, 'QueueName']
  }

  const alarmName = {
    'Fn::Join': [
      '',
      [
        `${stackName} sqs `,
        queueName,
        ` in ${region} approximate age of oldest message > ${threshold}s over the last ${evaluationPeriods} mins`
      ]
    ]
  }
  resources[`${logicalId}SqsApproximateAgeOfOldestMessageAlarm`] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: [{ Name: 'QueueName', Value: queueName }],
      MetricName: 'ApproximateAgeOfOldestMessage',
      Namespace: 'AWS/SQS',
      Statistic: 'Maximum',
      EvaluationPeriods: evaluationPeriods,
      Period: 60,
      Threshold: threshold,
      TreatMissingData: 'notBreaching'
    }
  }
}

function generateLambdaErrorRateAlarm({
  logicalId,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 0.1
  const evaluationPeriods = 5
  const functionName = { Ref: logicalId }
  const alarmName = {
    'Fn::Sub': `${stackName} lambda \${${logicalId}} in ${region} error rate > ${threshold * 100}% over the last ${evaluationPeriods} mins`
  }
  resources[`${logicalId}LambdaErrorRateAlarm`] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Metrics: [
        {
          Id: 'invocations',
          Label: 'Invocations',
          MetricStat: {
            Metric: {
              Dimensions: [
                {
                  Name: 'FunctionName',
                  Value: functionName
                }
              ],
              MetricName: 'Invocations',
              Namespace: 'AWS/Lambda'
            },
            Period: 60,
            Stat: 'Sum',
            Unit: 'Count'
          },
          ReturnData: false
        },
        {
          Id: 'errors',
          Label: 'Errors',
          MetricStat: {
            Metric: {
              Dimensions: [
                {
                  Name: 'FunctionName',
                  Value: functionName
                }
              ],
              MetricName: 'Errors',
              Namespace: 'AWS/Lambda'
            },
            Period: 60,
            Stat: 'Sum',
            Unit: 'Count'
          },
          ReturnData: false
        },
        {
          Id: 'errorRate',
          Label: 'Error Rate',
          Expression: 'errors / invocations',
          ReturnData: true
        }
      ],
      EvaluationPeriods: evaluationPeriods,
      Threshold: threshold
    }
  }
}

function generateSnsFailedToDriveToDlqAlarm({
  logicalId,
  resource,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 0
  const evaluationPeriods = 1
  const topicName = {
    'Fn::GetAtt': [resource.Properties.TopicArn.Ref, 'TopicName']
  }

  const alarmName = {
    'Fn::Join': [
      '',
      [
        `${stackName} sns `,
        topicName,
        ` in ${region} failed to drive to dlq count > ${threshold} over the last ${evaluationPeriods} mins`
      ]
    ]
  }
  resources[`${logicalId}SnsFailedToDriveToDlqAlarm`] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: [{ Name: 'TopicName', Value: topicName }],
      MetricName: 'NumberOfNotificationsFailedToRedriveToDlq',
      Namespace: 'AWS/SNS',
      Statistic: 'Sum',
      EvaluationPeriods: evaluationPeriods,
      Period: 60,
      Threshold: threshold
    }
  }
}

function generateRestApiErrorRateAlarm({
  apiName,
  httpMethod,
  restApiPath,
  resources,
  snsAlarmTopic,
  condition,
  region,
  stage
}) {
  const threshold = 0.1
  const evaluationPeriods = 5
  const alarmName = `${stackName} ${apiName} ${httpMethod} ${restApiPath} in ${region} error rate > ${threshold * 100}% over the last ${evaluationPeriods} mins`
  const dimensions = [
    { Name: 'ApiName', Value: apiName },
    { Name: 'Resource', Value: restApiPath },
    { Name: 'Method', Value: httpMethod },
    { Name: 'Stage', Value: stage }
  ]
  resources[
    `${restApiPath.replaceAll(/[^a-z]/gi, '')}${httpMethod}ErrorRateAlarm`
  ] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Metrics: [
        {
          Id: 'count',
          Label: 'Count',
          MetricStat: {
            Metric: {
              Dimensions: dimensions,
              MetricName: 'Count',
              Namespace: 'AWS/ApiGateway'
            },
            Period: 60,
            Stat: 'Sum',
            Unit: 'Count'
          },
          ReturnData: false
        },
        {
          Id: 'error4xx',
          Label: '4XX Error',
          MetricStat: {
            Metric: {
              Dimensions: dimensions,
              MetricName: '4XXError',
              Namespace: 'AWS/ApiGateway'
            },
            Period: 60,
            Stat: 'Sum',
            Unit: 'Count'
          },
          ReturnData: false
        },
        {
          Id: 'error5xx',
          Label: '5XX Error',
          MetricStat: {
            Metric: {
              Dimensions: dimensions,
              MetricName: '5XXError',
              Namespace: 'AWS/ApiGateway'
            },
            Period: 60,
            Stat: 'Sum',
            Unit: 'Count'
          },
          ReturnData: false
        },
        {
          Id: 'errorRate',
          Label: 'Error Rate',
          Expression: '(error4xx + error5xx) / count',
          ReturnData: true
        }
      ],
      EvaluationPeriods: evaluationPeriods,
      Threshold: threshold
    }
  }
}

function generateRestApiP90LatencyAlarm({
  apiName,
  httpMethod,
  restApiPath,
  resources,
  condition,
  region,
  stage
}) {
  const threshold = 3000
  const evaluationPeriods = 5
  const alarmName = `${stackName} ${apiName} ${httpMethod} ${restApiPath} in ${region} p90 latency > ${threshold}ms over the last ${evaluationPeriods} mins`
  resources[
    `${restApiPath.replaceAll(/[^a-z]/gi, '')}${httpMethod}P90LatencyAlarm`
  ] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: [
        { Name: 'ApiName', Value: apiName },
        { Name: 'Resource', Value: restApiPath },
        { Name: 'Method', Value: httpMethod },
        { Name: 'Stage', Value: stage }
      ],
      EvaluationPeriods: evaluationPeriods,
      MetricName: 'Latency',
      Namespace: 'AWS/ApiGateway',
      Period: 60,
      ExtendedStatistic: 'p90',
      Threshold: threshold
    }
  }
}

function getRestApiPath({ resourceId, resources, restApiPath = '' }) {
  if (resourceId.Ref) {
    const resource = resources[resourceId.Ref]
    const parentId = resource.Properties.ParentId

    return getRestApiPath({
      resourceId: parentId,
      resources,
      restApiPath: path.posix.join(resource.Properties.PathPart, restApiPath)
    })
  } else {
    return path.posix.join('/', restApiPath)
  }
}

function generateHttpApiErrorRateAlarm({
  apiName,
  httpMethod,
  httpApiPath,
  resource,
  resources,
  snsAlarmTopic,
  condition,
  region,
  stage
}) {
  const threshold = 0.1
  const evaluationPeriods = 5
  const alarmName = `${stackName} ${apiName} ${httpMethod} ${httpApiPath} in ${region} error rate > ${threshold * 100}% over the last ${evaluationPeriods} mins`
  const dimensions = [
    { Name: 'ApiId', Value: resource.Properties.ApiId },
    { Name: 'Resource', Value: httpApiPath },
    { Name: 'Method', Value: httpMethod },
    { Name: 'Stage', Value: stage }
  ]
  resources[
    `${httpApiPath.replaceAll(/[^a-z]/gi, '')}${httpMethod}ErrorRateAlarm`
  ] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Metrics: [
        {
          Id: 'count',
          Label: 'Count',
          MetricStat: {
            Metric: {
              Dimensions: dimensions,
              MetricName: 'Count',
              Namespace: 'AWS/ApiGateway'
            },
            Period: 60,
            Stat: 'Sum',
            Unit: 'Count'
          },
          ReturnData: false
        },
        {
          Id: 'error4xx',
          Label: '4XX Error',
          MetricStat: {
            Metric: {
              Dimensions: dimensions,
              MetricName: '4xx',
              Namespace: 'AWS/ApiGateway'
            },
            Period: 60,
            Stat: 'Sum',
            Unit: 'Count'
          },
          ReturnData: false
        },
        {
          Id: 'error5xx',
          Label: '5XX Error',
          MetricStat: {
            Metric: {
              Dimensions: dimensions,
              MetricName: '5xx',
              Namespace: 'AWS/ApiGateway'
            },
            Period: 60,
            Stat: 'Sum',
            Unit: 'Count'
          },
          ReturnData: false
        },
        {
          Id: 'errorRate',
          Label: 'Error Rate',
          Expression: '(error4xx + error5xx) / count',
          ReturnData: true
        }
      ],
      EvaluationPeriods: evaluationPeriods,
      Threshold: threshold
    }
  }
}

function generateWebSocketErrorRateAlarm({
  apiName,
  resource,
  resources,
  snsAlarmTopic,
  condition,
  region,
  stage
}) {
  const threshold = 0.1
  const evaluationPeriods = 5
  const routeKey = resource.Properties.RouteKey
  const alarmName = `${stackName} ${apiName} ${routeKey} in ${region} error rate > ${threshold * 100}% over the last ${evaluationPeriods} mins`
  const dimensions = [
    { Name: 'ApiId', Value: resource.Properties.ApiId },
    { Name: 'Route', Value: routeKey },
    { Name: 'Stage', Value: stage }
  ]

  resources[`websocket${routeKey.replaceAll(/[^a-z]/gi, '')}ErrorRateAlarm`] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Metrics: [
        routeKey === '$connect'
          ? {
              Id: 'count',
              Label: 'Count',
              MetricStat: {
                Metric: {
                  Dimensions: dimensions,
                  MetricName: 'ConnectCount',
                  Namespace: 'AWS/ApiGateway'
                },
                Period: 60,
                Stat: 'Sum',
                Unit: 'Count'
              },
              ReturnData: false
            }
          : {
              Id: 'count',
              Label: 'Count',
              MetricStat: {
                Metric: {
                  Dimensions: dimensions,
                  MetricName: 'MessageCount',
                  Namespace: 'AWS/ApiGateway'
                },
                Period: 60,
                Stat: 'Sum',
                Unit: 'Count'
              },
              ReturnData: false
            },
        {
          Id: 'integrationError',
          Label: 'Integration Error',
          MetricStat: {
            Metric: {
              Dimensions: dimensions,
              MetricName: 'IntegrationError',
              Namespace: 'AWS/ApiGateway'
            },
            Period: 60,
            Stat: 'Sum',
            Unit: 'Count'
          },
          ReturnData: false
        },
        {
          Id: 'executionError',
          Label: 'Execution Error',
          MetricStat: {
            Metric: {
              Dimensions: dimensions,
              MetricName: 'ExecutionError',
              Namespace: 'AWS/ApiGateway'
            },
            Period: 60,
            Stat: 'Sum',
            Unit: 'Count'
          },
          ReturnData: false
        },
        {
          Id: 'errorRate',
          Label: 'Error Rate',
          Expression: '(integrationError + executionError) / count',
          ReturnData: true
        }
      ],
      EvaluationPeriods: evaluationPeriods,
      Threshold: threshold
    }
  }
}

function generateHttpApiP90LatencyAlarm({
  apiName,
  httpMethod,
  httpApiPath,
  resource,
  resources,
  condition,
  region
}) {
  const threshold = 3000
  const evaluationPeriods = 5
  const alarmName = `${stackName} ${apiName} ${httpMethod} ${httpApiPath} in ${region} p90 latency > ${threshold}ms over the last ${evaluationPeriods} mins`
  resources[
    `${httpApiPath.replaceAll(/[^a-z]/gi, '')}${httpMethod}P90LatencyAlarm`
  ] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: [
        { Name: 'ApiId', Value: resource.Properties.ApiId },
        { Name: 'Resource', Value: httpApiPath },
        { Name: 'Method', Value: httpMethod },
        { Name: 'Stage', Value: '$default' }
      ],
      EvaluationPeriods: evaluationPeriods,
      MetricName: 'Latency',
      Namespace: 'AWS/ApiGateway',
      Period: 60,
      ExtendedStatistic: 'p90',
      Threshold: threshold
    }
  }
}

function generateWafAlarms({
  logicalId,
  resource,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 0.1
  const evaluationPeriods = 5

  const acl = resource.Properties

  if (!acl?.VisibilityConfig?.CloudWatchMetricsEnabled) return

  const webAcl = {
    'Fn::Select': [
      3,
      { 'Fn::Split': [':', { 'Fn::GetAtt': [logicalId, 'LabelNamespace'] }] }
    ]
  }

  for (const rule of resource.Properties?.Rules ?? []) {
    if (!rule?.VisibilityConfig?.CloudWatchMetricsEnabled) continue
    const alarmName = {
      'Fn::Join': [
        '',
        [
          `${stackName} waf ${logicalId}`,
          rule.VisibilityConfig.MetricName,
          ` in ${region} block rate > ${
            threshold * 100
          }% over the last ${evaluationPeriods} mins`
        ]
      ]
    }
    resources[`${logicalId}${rule.Name.replaceAll(/[^a-z]/gi, '')}`] = {
      Type: 'AWS::CloudWatch::Alarm',
      Condition: condition,
      Properties: {
        AlarmActions: [snsAlarmTopic],
        AlarmDescription: alarmName,
        AlarmName: alarmName,
        ComparisonOperator: 'GreaterThanThreshold',
        Metrics: [
          {
            Id: 'allowedRequests',
            Label: 'AllowedRequests',
            MetricStat: {
              Metric: {
                Dimensions: [
                  {
                    Name: 'WebACL',
                    Value: webAcl
                  },
                  {
                    Name: 'Rule',
                    Value: acl?.VisibilityConfig?.MetricName
                  },
                  {
                    Name: 'Region',
                    Value: region
                  }
                ],
                MetricName: 'AllowedRequests',
                Namespace: 'AWS/WAFV2'
              },
              Period: 60,
              Stat: 'Sum'
            },
            ReturnData: false
          },
          {
            Id: 'blockedRequests',
            Label: 'BlockedRequests',
            MetricStat: {
              Metric: {
                Dimensions: [
                  {
                    Name: 'WebACL',
                    Value: webAcl
                  },
                  {
                    Name: 'Rule',
                    Value: rule?.VisibilityConfig?.MetricName
                  },
                  {
                    Name: 'Region',
                    Value: region
                  }
                ],
                MetricName: 'BlockedRequests',
                Namespace: 'AWS/WAFV2'
              },
              Period: 60,
              Stat: 'Sum'
            },
            ReturnData: false
          },
          {
            Id: 'blockedRate',
            Label: 'Block Rate',
            Expression: 'blockedRequests / (blockedRequests + allowedRequests)',
            ReturnData: true
          }
        ],
        EvaluationPeriods: evaluationPeriods,
        Threshold: threshold
      }
    }
  }
}

function generateS3BucketRequest4xxErrorAlarm({
  filterId,
  logicalId,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 0
  const evaluationPeriods = 5
  const filterName = (filterId?.['Fn::Sub'] ?? filterId)
    .replaceAll(/\${[^}]*}/g, '')
    .replaceAll(/[^a-z]/gi, '')
  const bucket = {
    Ref: logicalId
  }
  const alarmName = {
    'Fn::Join': [
      '',
      [
        `${stackName} s3 bucket `,
        bucket,
        ` in ${region} filter ${filterName} in ${region} 4xx errors > ${threshold} over the last ${evaluationPeriods} mins`
      ]
    ]
  }
  resources[`${logicalId}S3Bucket4XXError${filterName}Alarm`] = {
    Type: 'AWS::CloudWatch::Alarm',

    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: [
        { Name: 'BucketName', Value: { Ref: logicalId } },
        { Name: 'FilterId', Value: filterId }
      ],
      MetricName: '4xxErrors',
      Namespace: 'AWS/S3',
      Statistic: 'Sum',
      EvaluationPeriods: evaluationPeriods,
      Period: 60,
      Threshold: threshold
    }
  }
}

function generateS3BucketRequest5xxErrorAlarm({
  filterId,
  logicalId,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 0
  const evaluationPeriods = 5
  const filterName = (filterId?.['Fn::Sub'] ?? filterId)
    .replaceAll(/\${[^}]*}/g, '')
    .replaceAll(/[^a-z]/gi, '')
  const bucket = {
    Ref: logicalId
  }
  const alarmName = {
    'Fn::Join': [
      '',
      [
        `${stackName} s3 bucket `,
        bucket,
        ` in ${region} filter ${filterName} in ${region} 5xx errors > ${threshold} over the last ${evaluationPeriods} mins`
      ]
    ]
  }
  resources[`${logicalId}S3Bucket5xXError${filterName}Alarm`] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: [
        { Name: 'BucketName', Value: { Ref: logicalId } },
        { Name: 'FilterId', Value: filterId }
      ],
      MetricName: '5xxErrors',
      Namespace: 'AWS/S3',
      Statistic: 'Sum',
      EvaluationPeriods: evaluationPeriods,
      Period: 60,
      Threshold: threshold
    }
  }
}

function generatePipeAlarms({
  logicalId,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 0
  const evaluationPeriods = 1
  for (const metric of [
    'ExecutionError',
    'ExecutionTimeout',
    'ExecutionThrottled'
  ]) {
    const pipe = {
      Ref: logicalId
    }
    const alarmName = {
      'Fn::Join': [
        '',
        [
          `${stackName} pipe `,
          pipe,
          ` in ${region} ${metric} count > ${threshold} over the last ${evaluationPeriods} mins`
        ]
      ]
    }
    resources[`${logicalId}pipeError${metric}Alarm`] = {
      Type: 'AWS::CloudWatch::Alarm',
      Condition: condition,
      Properties: {
        AlarmActions: [snsAlarmTopic],
        AlarmDescription: alarmName,
        AlarmName: alarmName,
        ComparisonOperator: 'GreaterThanThreshold',
        Dimensions: [{ Name: 'PipeName', Value: pipe }],
        MetricName: metric,
        Namespace: 'AWS/EventBridge/Pipes',
        Statistic: 'Sum',
        EvaluationPeriods: evaluationPeriods,
        Period: 60,
        Threshold: threshold
      }
    }
  }
}

function generateCertificateExpiryAlarm({
  logicalId,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 30
  const evaluationPeriods = 1
  const certificate = {
    Ref: logicalId
  }
  const alarmName = {
    'Fn::Join': [
      '',
      [
        `${stackName} certificate `,
        certificate,
        ` in ${region} DaysToExpiry < ${threshold} over the last ${evaluationPeriods} mins`
      ]
    ]
  }
  resources[`${logicalId}certificateExpiryAlarm`] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'LessThanThreshold',
      Dimensions: [{ Name: 'CertificateArn', Value: certificate }],
      MetricName: 'DaysToExpiry',
      Namespace: 'AWS/CertificateManager',
      Statistic: 'Average',
      EvaluationPeriods: evaluationPeriods,
      Period: 60,
      Threshold: threshold
    }
  }
}

function generateKinesisFirehoseLimitAlarms({
  logicalId,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 0.75
  const evaluationPeriods = 5

  const stream = {
    Ref: logicalId
  }

  const dimensions = [{ Name: 'DeliveryStreamName', Value: stream }]

  for (const [incoming, limit] of [
    ['IncomingBytes', 'BytesPerSecondLimit'],
    ['IncomingRecords', 'RecordsPerSecondLimit'],
    ['IncomingPutRequests', 'PutRequestsPerSecondLimit']
  ]) {
    const alarmName = {
      'Fn::Join': [
        '',
        [
          `${stackName} kinesis firehose `,
          stream,
          ` in ${region} ${incoming} / 300  > ${
            threshold * 100
          }% of ${limit} over the last ${evaluationPeriods} mins`
        ]
      ]
    }
    resources[`${logicalId}kinesis${incoming}LimitAlarm`] = {
      Type: 'AWS::CloudWatch::Alarm',
      Condition: condition,
      Properties: {
        AlarmActions: [snsAlarmTopic],
        AlarmDescription: alarmName,
        AlarmName: alarmName,
        ComparisonOperator: 'GreaterThanThreshold',
        Metrics: [
          {
            Id: 'incoming',
            Label: incoming,
            MetricStat: {
              Metric: {
                Dimensions: dimensions,
                MetricName: incoming,
                Namespace: 'AWS/Firehose'
              },
              Period: 300,
              Stat: 'Sum'
            },
            ReturnData: false
          },
          {
            Id: 'limit',
            Label: limit,
            MetricStat: {
              Metric: {
                Dimensions: dimensions,
                MetricName: limit,
                Namespace: 'AWS/Firehose'
              },
              Period: 300,
              Stat: 'Sum'
            },
            ReturnData: false
          },
          {
            Id: 'limitPercentage',
            Label: 'Limit Percentage',
            Expression: '(incoming / 300) / limit',
            ReturnData: true
          }
        ],
        EvaluationPeriods: evaluationPeriods,
        Threshold: threshold
      }
    }
  }
}

function generateKinesisFirehoseDataFreshnessErrorAlarm({
  logicalId,
  resource,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const evaluationPeriods = 5
  const stream = {
    Ref: logicalId
  }

  const intervalInSeconds =
    resource.Properties.ExtendedS3DestinationConfiguration?.BufferingHints
      ?.IntervalInSeconds ?? 300
  const threshold = intervalInSeconds * 3

  const alarmName = {
    'Fn::Join': [
      '',
      [
        `${stackName} kinesis firehose `,
        stream,
        ` in ${region} DeliveryToS3.DataFreshness > ${threshold} over the last ${evaluationPeriods} mins`
      ]
    ]
  }
  resources[`${logicalId}kinesisDataFreshnessAlarm`] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: [{ Name: 'DeliveryStreamName', Value: stream }],
      MetricName: 'DeliveryToS3.DataFreshness',
      Namespace: 'AWS/Firehose',
      Statistic: 'Maximum',
      EvaluationPeriods: evaluationPeriods,
      Period: 60,
      Threshold: threshold
    }
  }
}

function generateKinesisFirehoseThrottleAlarm({
  logicalId,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 1
  const evaluationPeriods = 5
  const stream = {
    Ref: logicalId
  }
  const alarmName = {
    'Fn::Join': [
      '',
      [
        `${stackName} kinesis firehose `,
        stream,
        ` in ${region} ThrottledRecords > ${threshold} over the last ${evaluationPeriods} mins`
      ]
    ]
  }
  resources[`${logicalId}kinesisThrottleAlarm`] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: [{ Name: 'DeliveryStreamName', Value: stream }],
      MetricName: 'ThrottledRecords',
      Namespace: 'AWS/Firehose',
      Statistic: 'Sum',
      EvaluationPeriods: evaluationPeriods,
      Period: 60,
      Threshold: threshold
    }
  }
}

function generateKinesisFirehoseFailedConversionAlarm({
  logicalId,
  resources,
  snsAlarmTopic,
  condition,
  region
}) {
  const threshold = 1
  const evaluationPeriods = 5
  const stream = {
    Ref: logicalId
  }
  const alarmName = {
    'Fn::Join': [
      '',
      [
        `${stackName} kinesis firehose `,
        stream,
        ` in ${region} FailedConversion.Records > ${threshold} over the last ${evaluationPeriods} mins`
      ]
    ]
  }
  resources[`${logicalId}kinesisFailedConversionAlarm`] = {
    Type: 'AWS::CloudWatch::Alarm',
    Condition: condition,
    Properties: {
      AlarmActions: [snsAlarmTopic],
      AlarmDescription: alarmName,
      AlarmName: alarmName,
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: [{ Name: 'DeliveryStreamName', Value: stream }],
      MetricName: 'FailedConversion.Records',
      Namespace: 'AWS/Firehose',
      Statistic: 'Sum',
      EvaluationPeriods: evaluationPeriods,
      Period: 60,
      Threshold: threshold
    }
  }
}

function createCondition({ resource, template }) {
  template.Conditions ||= {}
  if (!template.Conditions.IsCloudwatchAlertsEnabled) {
    template.Conditions.IsCloudwatchAlertsEnabled = {
      'Fn::Equals': [
        {
          'Fn::FindInMap': [
            'AWSAccounts',
            {
              Ref: 'AWS::AccountId'
            },
            'cloudwatchAlertsEnabled'
          ]
        },
        true
      ]
    }
  }
  if (
    resource.Condition &&
    resource.Condition !== 'IsCloudwatchAlertsEnabled'
  ) {
    const conditionAndKey = `${resource.Condition}AndIsCloudwatchAlertsEnabled`
    if (!template.Conditions[conditionAndKey]) {
      template.Conditions[conditionAndKey] = {
        'Fn::And': [
          {
            Condition: resource.Condition
          },
          {
            Condition: 'IsCloudwatchAlertsEnabled'
          }
        ]
      }
    }
    return conditionAndKey
  } else {
    return 'IsCloudwatchAlertsEnabled'
  }
}
