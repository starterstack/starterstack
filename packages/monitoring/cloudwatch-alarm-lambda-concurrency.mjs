// @ts-check

import { LambdaClient, GetAccountSettingsCommand } from '@aws-sdk/client-lambda'

/** @type {import('@starterstack/sam-expand/plugins').Lifecycles} */
export const lifecycles = ['pre:expand']

const THRESHOLD_RATE = 0.8
const PERIOD = 60
const EVALUATION_PERIODS = 5

export const lifecycle = async function getRegionLimits({
  command,
  argv,
  template,
  log
}) {
  if (command === 'build' && argv.includes('--region')) {
    const region = argv[argv.indexOf('--region') + 1]
    const snsAlarmTopic = { Ref: 'SNSAlarmTopic' }
    const lambda = new LambdaClient({ apiVersion: '2015-03-31', region })
    const {
      AccountLimit: {
        UnreservedConcurrentExecutions: unreservedConcurrentExecutions = 1000
      } = {}
    } = await lambda.send(new GetAccountSettingsCommand({}))
    const threshold = unreservedConcurrentExecutions * THRESHOLD_RATE
    const alarmName = {
      'Fn::Sub': `\${Stack} lambda concurrent executions in ${region} > ${threshold} over the last ${EVALUATION_PERIODS} minutes`
    }
    log('adding cloudwatch alarm for lambda concurrency to resources %O', {
      unreservedConcurrentExecutions,
      region
    })
    template.Resources['CloudWatchAlarmLambdaConcurrency'] = {
      Type: 'AWS::CloudWatch::Alarm',
      Condition: 'IsCloudwatchAlertsEnabled',
      Properties: {
        AlarmActions: [snsAlarmTopic],
        AlarmDescription: alarmName,
        AlarmName: alarmName,
        ComparisonOperator: 'GreaterThanThreshold',
        MetricName: 'ConcurrentExecutions',
        Namespace: 'AWS/Lambda',
        Statistic: 'Maximum',
        EvaluationPeriods: EVALUATION_PERIODS,
        Period: PERIOD,
        Threshold: threshold
      }
    }
  }
}
