#!/usr/bin/env node

// @ts-check

import inquirer from 'inquirer'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import * as parse from '@starterstack/sam-expand/parse'
import logInfo from '@starterstack/sam-expand/log'
import {
  STSClient,
  GetCallerIdentityCommand,
  STSServiceException
} from '@aws-sdk/client-sts'

import {
  CloudFormationClient,
  DescribeStacksCommand
} from '@aws-sdk/client-cloudformation'

import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand
} from '@aws-sdk/client-s3'

import {
  SSMClient,
  GetParameterCommand,
  ParameterNotFound
} from '@aws-sdk/client-ssm'

/** @type {Map<string, CloudFormationClient>} */
const cloudFormationClients = new Map()

/** @type {Map<string, S3Client>} */
const s3Clients = new Map()

/** @type {Map<string, import('@aws-sdk/client-cloudformation').DescribeStacksOutput>} */
const cloudformationResults = new Map()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const settings = JSON.parse(
  await readFile(path.join(__dirname, 'settings.json'), 'utf8')
)

const sts = new STSClient({ region: 'us-east-1' })
const ssm = new SSMClient({ region: 'us-east-1' })

/** @type {string} */
let accountId

/** @type {import('@starterstack/sam-expand/plugins').Lifecycles} */
export const lifecycles = [
  'pre:expand',
  'post:delete',
  'post:deploy',
  'post:build'
]

/** @type {import('@starterstack/sam-expand/plugins').PluginSchema<{ region?: string, 'suffixStage': boolean, stage?: string, regions?: string }>} */
export const schema = {
  type: 'object',
  properties: {
    region: {
      type: 'string',
      nullable: true
    },
    regions: {
      type: 'string',
      nullable: true,
      enum: ['stage', 'account']
    },
    name: {
      type: 'string',
      nullable: true
    },
    stage: {
      type: 'string',
      nullable: true
    },
    suffixStage: {
      type: 'boolean'
    },
    addMappings: {
      type: 'boolean',
      nullable: true
    }
  },
  required: ['suffixStage'],
  additionalProperties: false
}

export const metadataConfig = 'stackStageConfig'

/** @type {import('@starterstack/sam-expand/plugins').Plugin} */
export const lifecycle = async function stackStageConfig({
  command,
  argv,
  argvReader,
  template,
  lifecycle,
  log
}) {
  if (lifecycle === 'post:build') {
    if (!process.env.CI) {
      const stage = argvReader('Stage', { parameter: true })
      const offline = process.env.IS_OFFLINE ? ' IS_OFFLINE=true' : ''
      console.log(
        `\u001B[0;33m[*] Lint SAM template: STAGE=${stage}${offline} npx sam-expand validate -t .aws-sam/build/template.yaml --lint\u001B[0;33m`
      )
    }
    return
  }

  if (lifecycle === 'pre:expand') {
    const stackStageConfig = await getStackStageConfig(template)
    if (command === 'build' && stackStageConfig.addMappings) {
      template.Mappings ||= {}
      template.Mappings.AWSAccounts = settings.awsAccounts
    }
    let stage = argvReader('Stage', { parameter: true })
    let region = argvReader('region')

    if (['build', 'deploy', 'delete', 'validate'].includes(command)) {
      if (!stage && process.env.STAGE) {
        stage = process.env.STAGE
      }
      if (!process.env.CI && !stage) {
        const { stageValue } =
          stackStageConfig.stage === 'global'
            ? { stageValue: 'global' }
            : await inquirer.prompt({ name: 'stageValue', message: 'stage' })
        stage = stageValue
        process.env.STAGE = stage
      }
    }

    if (!stage) {
      throw new TypeError('missing stage')
    }

    const config = await getConfig({ stage, template })

    if (!process.env.CI && !region) {
      const { regionValue } =
        config.regions.length === 1
          ? { regionValue: config.regions.at(0) }
          : await inquirer.prompt({
              name: 'regionValue',
              type: 'list',
              message: 'region',
              choices: config.regions
            })

      if (regionValue) {
        region = regionValue
        if (['build', 'deploy', 'delete', 'validate'].includes(command)) {
          argv.push('--region', regionValue)
        }
      }
    }

    if (!region) {
      throw new TypeError('missing region')
    }

    if (['deploy', 'delete'].includes(command)) {
      argv.push('--stack-name', `'${config.stackName}'`)
      if (config.s3DeploymentBucket[region]) {
        argv.push(
          '--s3-bucket',
          `'${config.s3DeploymentBucket[region]}'`,
          '--s3-prefix',
          command === 'deploy'
            ? `'${config.stackName}/${template.Outputs.DeployedCommit.Value}'`
            : `'${config.stackName}'`
        )
      }
    }
    if (command === 'deploy') {
      if (config.snsOpsTopic[region]) {
        argv.push(
          '--notification-arns',
          `'${config.snsOpsTopic[region] ?? ''}'`
        )
      }
      argv.push(
        '--tags',
        `STAGE='${stage}'`,
        `ManagedBy='${settings.stackName}'`,
        `Name='${config.stackName}'`
      )
    }
    if (['build', 'deploy'].includes(command)) {
      addParameter({ argv, name: 'Stack', value: settings.stackName })
      addParameter({ argv, name: 'Stage', value: stage })
    }
    log('applied stack stage config %O', { config, argv })
  } else {
    if (argv.includes('--s3-bucket') && argv.includes('--s3-prefix')) {
      const region = argvReader('region')
      if (!region) {
        throw new TypeError('missing region')
      }
      const s3Bucket = argvReader('s3-bucket')
      if (!s3Bucket) {
        throw new TypeError('missing s3-bucket')
      }
      const s3Prefix = argvReader('s3-prefix')
      if (!s3Prefix) {
        throw new TypeError('missing s3-prefix')
      }

      let s3Client = s3Clients.get(region)

      if (!s3Client) {
        s3Client = new S3Client({ region })
        s3Clients.set(region, s3Client)
      }

      const keys = await listS3Objects({
        bucket: s3Bucket,
        prefix: s3Prefix.split('/')[0],
        s3Client
      })

      for (const key of keys) {
        // post deploy delete files for older commits
        // post delete delete all prefix files
        if (lifecycle === 'post:deploy' && key?.startsWith(s3Prefix)) {
          continue
        }
        logInfo('delete s3 object %O', { key })
        await s3Client.send(
          new DeleteObjectCommand({ Key: key, Bucket: s3Bucket })
        )
      }
    }
  }
}

/**
 * @param {{ stage: string, template: any, directory?: string }} options
 * @returns {Promise<{ addMappings: boolean, stackName: string, stage: string, regions: string[], s3DeploymentBucket: Record<string, string>, snsOpsTopic: Record<string, string>, snsAlarmTopic: Record<string, string>, stackRegion: string }>}
 **/
export async function getConfig({ stage, template, directory }) {
  const config = await getStackStageConfig({ template, directory })
  const name = config.name ?? path.basename(directory ?? process.cwd())
  const stackStage = config.stage ?? stage
  const cloudformationStackName = config.suffixStage
    ? `${settings.stackName}-${name}-${stackStage}`
    : `${settings.stackName}-${name}`

  if (
    (!process.env.CI && process.env.IS_OFFLINE === 'true') ||
    stage === 'local'
  ) {
    useLocalOfflineConfig()
  } else {
    try {
      if (!accountId) {
        const { Account: account } = await sts.send(
          new GetCallerIdentityCommand({})
        )

        if (account) {
          accountId = account
        } else {
          throw new TypeError('missing aws credentials')
        }
      }
    } catch (error) {
      if (!process.env.CI && !(error instanceof STSServiceException)) {
        const { offline } = await inquirer.prompt({
          type: 'confirm',
          message: 'No credentials found, run locally with no credentials',
          default: true,
          name: 'offline'
        })
        if (offline) {
          useLocalOfflineConfig()
        } else {
          throw error
        }
      } else {
        throw error
      }
    }
  }

  if (!settings.awsAccounts[accountId]) {
    throw new TypeError(`${accountId} not known in settings.awsAccounts`)
  }

  const stageName =
    stage === 'global'
      ? 'global'
      : settings.stages.includes(stage)
        ? stage
        : 'feature'
  const accountStage = settings.regions[settings.awsAccounts[accountId]?.stage]

  const regions = settings.accountPerStage
    ? [accountStage]
    : Object.values(settings.regions)

  const accountRegion = settings.regions[settings.awsAccounts[accountId].stage]

  const stackRegion = settings.regions[stageName]

  /** @type {string[]} */
  const stackRegions =
    config.regions === 'account'
      ? [...new Set(['us-east-1', 'eu-west-1', ...regions])]
      : [config.region ?? stackRegion ?? accountRegion]

  /** @type {Record<string, string>} */
  const s3DeploymentBuckets = {}

  /** @type {Record<string, string>} */
  const snsOpsTopics = {}

  /** @type {Record<string, string>} */
  const snsAlarmTopics = {}

  await Promise.all(
    stackRegions.map(async function getDeploymentBucket(region) {
      const deploymentStack = `${settings.stackName}-deployment`
      const s3DeploymentBucket = await getCloudFormationOutput({
        region,
        stackName: deploymentStack,
        outputKey: 'S3DeploymentBucket'
      })
      if (s3DeploymentBucket) {
        s3DeploymentBuckets[region] = s3DeploymentBucket
      }
      const snsOpsTopic = await getCloudFormationOutput({
        region,
        stackName: deploymentStack,
        outputKey: 'SNSOpsTopic'
      })
      if (snsOpsTopic) {
        snsOpsTopics[region] = snsOpsTopic
      }
      if (
        !['deployment', 'monitoring'].includes(
          path.basename(directory ?? process.cwd())
        )
      ) {
        const monitoringStack = `${settings.stackName}-monitoring`
        const snsAlarmTopic = await getCloudFormationOutput({
          region,
          stackName: monitoringStack,
          outputKey: 'SNSAlarmTopic'
        })
        if (snsAlarmTopic) {
          snsAlarmTopics[region] = snsAlarmTopic
        }
      }
    })
  )

  return {
    stackName: cloudformationStackName,
    stage: stackStage,
    regions: stackRegions,
    stackRegion,
    s3DeploymentBucket: s3DeploymentBuckets,
    snsOpsTopic: snsOpsTopics,
    snsAlarmTopic: snsAlarmTopics,
    addMappings: config.addMappings
  }
}

/**
 * @param {{ template: any, directory?: string }} options
 * @returns Promise<{import('@starterstack/sam-expand/plugins').PluginSchema<{ addMappings: boolean, region?: string, 'suffixStage': boolean, stage?: string, regions?: string }>}>}
 **/
async function getStackStageConfig({ template, directory }) {
  if (!template) {
    const templateFile = path.join(directory ?? process.cwd(), 'template.yaml')
    try {
      await stat(templateFile)
    } catch {
      throw new TypeError('no template.yaml found')
    }
    template = await parse.template(templateFile)
  }
  return template.Metadata.expand.config.stackStageConfig
}

/**
 * @param {string} outputKey
 * @returns {Promise<string | undefined>}
 **/
async function getStackOutput(outputKey) {
  return await getCloudFormationOutput({
    region: 'us-east-1',
    stackName: `${settings.stackName}-stack`,
    outputKey
  })
}

/** @type {import('@starterstack/sam-expand/resolve').FileResolver} */
export default async function getSettings({
  template,
  templateDirectory,
  argvReader,
  region: defaultRegion
}) {
  const region = argvReader('region') ?? defaultRegion
  const stage = argvReader('Stage', { parameter: true }) ?? process.env.STAGE

  if (!region) {
    throw new TypeError('missing region')
  }

  if (!stage) {
    throw new TypeError('missing stage')
  }

  const config = await getConfig({
    stage,
    template,
    directory: templateDirectory
  })

  /**
   * @param {string} outputKey
   * @returns {Promise<string | undefined>}
   */
  const getCDNOutput = (outputKey) => {
    return getCloudFormationOutput({
      region: config.stackRegion,
      stackName: `${settings.stackName}-cdn-${stage}`,
      outputKey
    })
  }

  /**
   * @param {string} outputKey
   * @returns {Promise<string | undefined>}
   */
  const getDynamoDBOutput = (outputKey) => {
    return getCloudFormationOutput({
      region: config.stackRegion,
      stackName: `${settings.stackName}-dynamodb-${stage}`,
      outputKey
    })
  }

  return {
    get stackName() {
      return config.stackName
    },
    get region() {
      return region
    },
    get stage() {
      return config.stage
    },
    get sentryEnvironment() {
      return settings.stages.includes(config.stage) ? config.stage : 'feature'
    },
    get sentryDSN() {
      return 'https://_@_._/0'
    },
    get rootDomain() {
      return settings.rootDomain
    },
    get devRoot() {
      return `dev.${settings.stackRootDomain}`
    },
    get wildcardCertName() {
      return `*.feature.${settings.stackRootDomain}`
    },
    get stageOrStackRoot() {
      const accountStage = settings.accountPerStage
        ? settings.awsAccounts[accountId]?.stage
        : stage
      if (accountStage === 'dev') {
        return `dev.${settings.stackRootDomain}`
      } else if (accountStage === 'prod') {
        return settings.stackRootDomain
      } else {
        return `${stage}.feature.${settings.stackRootDomain}`
      }
    },
    get stageRootUrl() {
      const accountStage = settings.accountPerStage
        ? settings.awsAccounts[accountId]?.stage
        : stage
      if (accountStage === 'dev') {
        return `https://dev.${settings.stackRootDomain}`
      } else if (accountStage === 'prod') {
        return `https://${settings.stackRootDomain}`
      } else {
        if (stage === 'global') {
          throw new Error(
            'stageRootUrl not available for feature + global stage'
          )
        }
        return `https://${stage}.feature.${settings.stackRootDomain}`
      }
    },
    get acmCertificateArn() {
      const accountStage = settings.accountPerStage
        ? settings.awsAccounts[accountId]?.stage
        : stage

      if (accountStage === 'dev') {
        return getStackOutput(settings.accountPerStage ? 'RootCert' : 'DevCert')
      } else if (accountStage === 'prod') {
        return getStackOutput('RootCert')
      } else {
        if (stage === 'global') {
          throw new Error(
            'acmCertificateArn not available for feature + global stage'
          )
        }
        return getStackOutput('WildcardCert')
      }
    },
    get productionStage() {
      return 'prod'
    },
    get productionRegion() {
      return settings.regions.prod
    },
    get productionAccountId() {
      const [productionAccountId] =
        Object.entries(settings.awsAccounts).find(function isProduction([
          ,
          { stage }
        ]) {
          return stage === 'prod'
        }) ?? []
      return productionAccountId
    },
    get backupStage() {
      return 'backup'
    },
    get backupRegion() {
      return settings.regions.backup
    },
    get backupAccountId() {
      const [backupAccountId] =
        Object.entries(settings.awsAccounts).find(function isbackup([
          ,
          { stage }
        ]) {
          return stage === 'backup'
        }) ?? []
      return backupAccountId
    },
    get logRetentionInDays() {
      return settings.defaultLogRetentionInDays
    },
    get stackDisplayName() {
      return settings.stackDisplayName
    },
    get accountRegion() {
      return settings.regions[settings.awsAccounts[accountId].stage]
    },
    get accountPerStage() {
      return String(settings.accountPerStage)
    },
    get snsOpsTopic() {
      return config.snsOpsTopic?.[region]
    },
    get snsAlarmTopic() {
      return config.snsAlarmTopic?.[region]
    },
    get accountIds() {
      return Object.keys(settings.awsAccounts).join(',')
    },
    get ssmS3LogBucket() {
      return getParameter(`/${settings.stackName}/global/S3_LOG_BUCKET`)
    },
    get ssmS3BackupBucket() {
      return getParameter(`/${settings.stackName}/global/S3_BACKUP_BUCKET`)
    },
    get stackRegion() {
      return config.stackRegion
    },
    get apiGatewayCloudwatchRole() {
      return getStackOutput('ApiGatewayCloudwatchRole')
    },
    get s3Media() {
      return getCDNOutput('S3MediaBucket')
    },
    get s3ProtectedMedia() {
      return getCDNOutput('S3ProtectedMediaBucket')
    },
    get s3Static() {
      return getCDNOutput('S3StaticBucket')
    },
    get s3CloudFrontLogs() {
      return getCDNOutput('S3CloudFrontLogsBucket')
    },
    get s3ProtectedMediaLogs() {
      return getCDNOutput('S3ProtectedMediaLogsBucket')
    },
    get cloudFrontWafACL() {
      return getCloudFormationOutput({
        region: 'us-east-1',
        stackName: `${settings.stackName}-cloudfront-us-east-1-${stage}`,
        outputKey: 'CloudFrontWafACL'
      })
    },
    get zoneId() {
      return getStackOutput('ZoneId')
    },
    get apiGatewayRestLogFormat() {
      const awsAccountSettings = settings.awsAccounts[accountId]
      const wafEnabled = awsAccountSettings?.wafEnabled

      return `{"requestTime":"$context.requestTime","requestId":"$context.requestId","httpMethod":"$context.httpMethod","path":"$context.path","resourcePath":"$context.resourcePath","status":$context.status,"responseLatency":"$context.responseLatency","xrayTraceId":"$context.xrayTraceId","integrationRequestId":"$context.integration.requestId","functionResponseStatus":"$context.integration.status","integrationLatency":"$context.integration.latency","integrationServiceStatus":"$context.integration.integrationStatus","authorizeResultStatus":"$context.authorize.status","authorizerLatency":"$context.authorizer.latency","authorizerRequestId":"$context.authorizer.requestId","ip":"$context.identity.sourceIp","userAgent":"$context.identity.userAgent","user":"$context.authorizer.id"${
        wafEnabled
          ? ',"wafError":"$context.waf.error","wafLatency":"$context.waf.latency","wafStatus":"$context.waf.status","wafResponse":"$context.wafResponseCode"'
          : ''
      }}`
    },
    get dynamodbStackTable() {
      return getDynamoDBOutput('DynamoDBStackTable')
    },
    get dynamodbStackAuditTable() {
      return getDynamoDBOutput('DynamoDBStackAuditTable')
    },
    get dynamodbWebSocketTable() {
      return getDynamoDBOutput('DynamoDBWebSocketTable')
    },
    get dynamodbStackTableStream() {
      return getDynamoDBOutput('DynamoDBStackTableStream')
    }
  }
}

/**
 * @param {{
 * region: string
 * stackName: string
 * outputKey: string
 * }} options
 * @returns {Promise<string | undefined>}
 **/

async function getCloudFormationOutput({ region, stackName, outputKey }) {
  if (process.env.IS_OFFLINE === 'true') {
    return outputKey
  }
  let result = cloudformationResults.get(`${region}.${stackName}`)
  if (!result) {
    let client = cloudFormationClients.get(region)
    if (!client) {
      client = new CloudFormationClient({ region })
      cloudFormationClients.set(region, client)
    }
    try {
      result = await client.send(
        new DescribeStacksCommand({
          StackName: stackName
        })
      )
      cloudformationResults.set(`${region}.${stackName}`, result)
    } catch {
      // eslint-disable-next-line no-empty
    }
  }
  for (const output of result?.Stacks?.[0]?.Outputs ?? []) {
    if (output.OutputKey === outputKey) {
      return output.OutputValue
    }
  }
}

/**
 * @param {string} name
 * @returns {Promise<string | undefined>}
 **/

async function getParameter(name) {
  if (process.env.IS_OFFLINE === 'true') {
    return name
  }
  try {
    const { Parameter: parameter } = await ssm.send(
      new GetParameterCommand({
        Name: name,
        WithDecryption: true
      })
    )
    return parameter?.Value
  } catch (error) {
    if (!(error instanceof ParameterNotFound)) {
      throw error
    }
  }
}

/**
 * @param {{ s3Client: S3Client, prefix: string, bucket: string }} options
 * @returns {Promise<string[]>}
 **/
async function listS3Objects({ s3Client, prefix, bucket }) {
  /** @type {string[]} */
  const files = []
  /** @type {string | undefined} */
  let nextToken
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await s3Client.send(
      new ListObjectsV2Command({
        ...(nextToken && { ContinuationToken: nextToken }),
        Bucket: bucket,
        Prefix: prefix
      })
    )
    if (result?.Contents?.length) {
      for (const { Key: key } of result.Contents) {
        if (key) {
          files.push(key)
        }
      }
    }
    nextToken = result.NextContinuationToken
    if (!nextToken) break
  }
  return files
}

/**
 * @param {{ argv: string[], name: string, value: string }} options
 * @returns {void}
 **/

function addParameter({ argv, name, value }) {
  if (!argv.includes('--parameter-overrides')) {
    argv.push('--parameter-overrides')
  }
  const parameterIndex = argv.findIndex((x) => x.startsWith(`${name}=`))

  if (parameterIndex === -1) {
    const parameterOverridesIndex = argv.indexOf('--parameter-overrides')
    argv.splice(parameterOverridesIndex + 1, 0, `${name}='${value}'`)
  } else {
    argv.splice(parameterIndex, 1, `${name}='${value}'`)
  }
}

function useLocalOfflineConfig() {
  accountId = '1'.repeat(12)
  process.env.IS_OFFLINE = 'true'
  const devAccountId = settings.accountPerStage
    ? Object.entries(settings.awsAccounts).find(
        ([, v]) => v.stage === 'dev'
      )?.[0]
    : Object.keys(settings.awsAccounts).at(0)

  if (!devAccountId) {
    throw new Error('could not find account with stage "dev" to copy')
  }
  settings.awsAccounts[accountId] = settings.awsAccounts[devAccountId]
}
