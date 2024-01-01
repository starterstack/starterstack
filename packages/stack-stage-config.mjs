#!/usr/bin/env node

// @ts-check

import inquirer from 'inquirer'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import * as parse from '@starterstack/sam-expand/parse'
import logInfo from '@starterstack/sam-expand/log'
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
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

let accountId

/** @type {import('@starterstack/sam-expand/plugins').Lifecycles} */
export const lifecycles = ['pre:expand', 'post:delete', 'post:deploy']

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
export const lifecycle = async function stackStageConfig ({
  command,
  argv,
  template,
  lifecycle,
  log
}) {
  if (lifecycle === 'pre:expand') {
    const stackStageConfig = await getStackStageConfig(template)
    if (command === 'build' && stackStageConfig.addMappings) {
      template.Mappings ||= {}
      template.Mappings.AWSAccounts = settings.awsAccounts
    }
    if (!process.env.CI && !argv.includes('--region')) {
      const { stage } =
        stackStageConfig.stage === 'global'
          ? { stage: 'global' }
          : await inquirer.prompt({ name: 'stage', message: 'stage' })
      if (!stage) {
        throw new TypeError('missing stage')
      }

      const config = await getConfig({ stage, template })

      const { region } =
        config.regions.length === 1
          ? { region: config.regions.at(0) }
          : await inquirer.prompt({
            name: 'region',
            type: 'list',
            message: 'region',
            choices: config.regions
          })
      if (['build', 'deploy'].includes(command)) {
        argv.push(
          ...[
            '--parameter-overrides',
            `Stack=${settings.stackName}`,
            `Stage=${stage}`
          ]
        )
      }
      if (['deploy', 'delete'].includes(command)) {
        argv.push(...['--stack-name', config.stackName])
        if (config.s3DeploymentBucket[region]) {
          argv.push(...['--s3-bucket', config.s3DeploymentBucket[region]])
          argv.push(
            ...[
              '--s3-prefix',
              `${config.stackName}/${template.Outputs.DeployedCommit.Value}`
            ]
          )
        }
      }
      if (['build', 'deploy', 'delete', 'validate'].includes(command)) {
        argv.push(...['--region', region])
      }
      if (command === 'deploy' && config.snsOpsTopic[region]) {
        argv.push(...['--notification-arns', config.snsOpsTopic[region]])
        argv.push(
          ...[
            '--tags',
            `STAGE=${stage}`,
            `ManagedBy=${settings.stackName}`,
            `Name=${config.stackName}`
          ]
        )
      }
      log('applied stack stage config %O', { config, argv })
    }
  } else {
    if (argv.includes('--s3-bucket') && argv.includes('--s3-prefix')) {
      const region = argv[argv.indexOf('--region') + 1]
      const stage = argv[argv.findIndex((x) => x.startsWith('Stage='))]
      const s3Bucket = argv[argv.indexOf('--s3-bucket') + 1]
      const s3Prefix = argv[argv.indexOf('--s3-prefix') + 1]

      if (!region) {
        throw new TypeError('missing region')
      }
      if (!stage) {
        throw new TypeError('missing stage')
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
        if (lifecycle === 'post:deploy') {
          if (key?.startsWith(s3Prefix)) {
            continue
          }
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
 * @returns {Promise<{ addMappings: boolean, stackName: string, stage: string, regions: string[], s3DeploymentBucket: Record<string, string>, snsOpsTopic: Record<string, string> }>}
 **/
export async function getConfig ({ stage, template, directory }) {
  const config = await getStackStageConfig({ template, directory })
  const name = config.name ?? path.basename(directory ?? process.cwd())
  const stackStage = config.stage ?? stage
  const cloudformationStackName = config.suffixStage
    ? `${settings.stackName}-${name}-${stackStage}`
    : `${settings.stackName}-${name}`

  if (!accountId) {
    const { Account: account } = await sts.send(
      new GetCallerIdentityCommand({})
    )
    accountId = account

    if (!accountId) {
      throw new TypeError('missing aws credentials')
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
  const s3DeploymentBucket = {}

  /** @type {Record<string, string>} */
  const snsOpsTopic = {}

  if (path.basename(directory ?? process.cwd()) !== 'deployment') {
    await Promise.all(
      stackRegions.map(async function getDeploymentBucket (region) {
        const stackName = `${settings.stackName}-deployment`
        let result = cloudformationResults.get(`${region}.${stackName}`)
        if (!result) {
          let client = cloudFormationClients.get(region)
          if (!client) {
            client = new CloudFormationClient({ region })
            cloudFormationClients.set(region, client)
          }
          result = await client.send(
            new DescribeStacksCommand({
              StackName: stackName
            })
          )
          cloudformationResults.set(`${region}.${stackName}`, result)
        }
        for (const output of result?.Stacks?.[0]?.Outputs ?? []) {
          if (output.OutputKey === 'S3DeploymentBucket' && output.OutputValue) {
            s3DeploymentBucket[region] = output.OutputValue
          } else if (output.OutputKey === 'SNSOpsTopic' && output.OutputValue) {
            snsOpsTopic[region] = output.OutputValue
          }
        }
      })
    )
  }

  return {
    stackName: cloudformationStackName,
    stage: stackStage,
    regions: stackRegions,
    s3DeploymentBucket,
    snsOpsTopic,
    addMappings: config.addMappings
  }
}

/**
 * @param {{ template: any, directory?: string }} options
 * @returns Promise<{import('@starterstack/sam-expand/plugins').PluginSchema<{ addMappings: boolean, region?: string, 'suffixStage': boolean, stage?: string, regions?: string }>}>}
 **/
async function getStackStageConfig ({ template, directory }) {
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

/** @type {import('@starterstack/sam-expand/resolve').FileResolver} */
export default async function getSettings ({
  template,
  templateDirectory,
  argv,
  region: defaultRegion
}) {
  const region = argv[argv.indexOf('--region') + 1] ?? defaultRegion
  const stage = argv[argv.findIndex((x) => x.startsWith('Stage='))]

  if (!region) {
    throw new TypeError('missing region')
  }

  if (!stage) {
    throw new TypeError('missing stage')
  }

  const config = await getConfig({
    stage: stage.slice('Stage='.length),
    template,
    directory: templateDirectory
  })

  return {
    get productionStage () {
      return 'prod'
    },
    get productionRegion () {
      return settings.regions.prod
    },
    get productionAccountId () {
      const [productionAccountId] =
        Object.entries(settings.awsAccounts).find(function isProduction ([
          _,
          { stage }
        ]) {
          return stage === 'prod'
        }) ?? []
      return productionAccountId
    },
    get backupStage () {
      return 'backup'
    },
    get backupRegion () {
      return settings.regions.backup
    },
    get backupAccountId () {
      const [backupAccountId] =
        Object.entries(settings.awsAccounts).find(function isbackup ([
          _,
          { stage }
        ]) {
          return stage === 'backup'
        }) ?? []
      return backupAccountId
    },
    get logRetentionInDays () {
      return settings.defaultLogRetentionInDays
    },
    get stackDisplayName () {
      return settings.stackDisplayName
    },
    get accountRegion () {
      return settings.regions[settings.awsAccounts[accountId].stage]
    },
    get accountPerStage () {
      return String(settings.accountPerStage)
    },
    get snsOpsTopic () {
      return config.snsOpsTopic?.[region]
    },
    get snsAlarmTopic () {
      return undefined
    },
    get accountIds () {
      return Object.keys(settings.awsAccounts).join(',')
    },
    get ssmS3LogBucket () {
      return getParameter(`/${settings.stackName}/global/S3_LOG_BUCKET`)
    },
    get ssmS3BackupBucket () {
      return getParameter(`/${settings.stackName}/global/S3_BACKUP_BUCKET`)
    }
  }
}

/**
 * @param {string} name
 * @returns {Promise<string | undefined>}
 **/

async function getParameter (name) {
  try {
    const { Parameter: parameter } = await ssm.send(
      new GetParameterCommand({
        Name: name,
        WithDecryption: true
      })
    )
    return parameter?.Value
  } catch (err) {
    if (!(err instanceof ParameterNotFound)) {
      throw err
    }
  }
}

/**
 * @param {{ s3Client: S3Client, prefix: string, bucket: string }} options
 * @returns {Promise<string[]>}
 **/
async function listS3Objects ({ s3Client, prefix, bucket }) {
  const files = []
  let nextToken
  while (true) {
    const result = await s3Client.send(
      new ListObjectsV2Command({
        ...(nextToken && { ContinuationToken: nextToken }),
        Bucket: bucket,
        Prefix: prefix
      })
    )
    files.push(...result.Contents)
    nextToken = result.NextContinuationToken
    if (!nextToken) break
  }
  return files.map(x => x.Key)
}
