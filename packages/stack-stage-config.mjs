#!/usr/bin/env node

// @ts-check

import inquirer from 'inquirer'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import * as parse from '@starterstack/sam-expand/parse'
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import {
  CloudFormationClient,
  DescribeStacksCommand
} from '@aws-sdk/client-cloudformation'

/** @type {Map<string, CloudFormationClient>} */
const clients = new Map()

/** @type {Map<string, import('@aws-sdk/client-cloudformation').DescribeStacksOutput>} */
const cloudformationResults = new Map()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const settings = JSON.parse(
  await readFile(path.join(__dirname, 'settings.json'), 'utf8')
)

const sts = new STSClient({ region: 'us-east-1' })

let accountId

/** @type {import('@starterstack/sam-expand/plugins').Lifecycles} */
export const lifecycles = ['pre:expand']

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
      enum: [
        "stage",
        "account",
      ]
    },
    name: {
      type: 'string',
      nullable: true
    },
    stage: {
      type: 'string',
      nullable: true
    },
    'suffixStage': {
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
export const lifecycle = async function stackStageConfig({ command, argv, template, log }) {
  const stackStageConfig = await getStackStageConfig(template)
  if (command === 'build' && stackStageConfig.addMappings) {
    template.Mappings ||= {}
    template.Mappings.AWSAccounts = settings.awsAccounts
  }
  if (!process.env.CI && command !== 'validate' && (!argv.includes('--stack-name') || !argv.includes('--region'))) {
    const { stage } = stackStageConfig.stage === 'global' ? { stage: 'global' } : await inquirer.prompt({ name: 'stage', message: 'stage' })
    if (!stage) {
      throw new TypeError('missing stage')
    }

    const config = await getConfig({ stage, template })

    const { region } = config.regions.length === 1 ? { region: config.regions.at(0) } : await inquirer.prompt({ name: 'region', type: 'list', message: 'region', choices: config.regions })
    if (['build', 'deploy'].includes(command)) {
      argv.push(...['--parameter-overrides', `Stack=${settings.stackName}`, `Stage=${stage}`])
    }
    if (['deploy', 'delete'].includes(command)) {
      argv.push(...['--stack-name', config.stackName])
      if (config.s3DeploymentBucket[region]) {
        argv.push(...['--s3-bucket', config.s3DeploymentBucket[region]])
      }
    }
    if (['build', 'deploy', 'delete', 'validate'].includes(command)) {
      argv.push(...['--region', region])
    }
    if (command === 'deploy' && config.snsOpsTopic[region]) {
      argv.push(...['--notification-arns', config.snsOpsTopic[region]])
      argv.push(...['--tags', `STAGE=${stage}`, `ManagedBy=${settings.stackName}`, `Name=${config.stackName}`])
    }
    log('applied stack stage config %O', { config, argv })
  }
}

/**
 * @param {{ stage: string, template: any, directory?: string }} options
 * @returns {Promise<{ addMappings: boolean, addMissings: true, stackName: string, stage: string, regions: string[], s3DeploymentBucket: Record<string, string>, snsOpsTopic: Record<string, string> }>}
 **/
export async function getConfig({ stage, template, directory }) {
  const config = await getStackStageConfig({ template, directory })
  const name = config.name ?? path.basename(directory ?? process.cwd())
  const stackStage = config.stage ?? stage
  const cloudformationStackName = config.suffixStage ? `${settings.stackName}-${name}-${stackStage}` : `${settings.stackName}-${name}`

  if (!accountId) {
    const { Account: account } = await sts.send(new GetCallerIdentityCommand({}))
    accountId = account

    if (!accountId) {
      throw new TypeError('missing aws credentials')
    }
  }

  if (!settings.awsAccounts[accountId]) {
    throw new TypeError(`${accountId} not known in settings.awsAccounts`)
  }

  const stageName = settings.stages.includes(stage) ? stage : 'feature'
  const accountStage = settings.regions[settings.awsAccounts[accountId]?.stage]

  const regions = settings.accountPerStage
    ? [accountStage]
    : Object.values(settings.regions)

  const stackRegion = settings.regions[stageName]
  const stackRegions = config.regions === 'account'
      ? [...new Set(['us-east-1', 'eu-west-1', ...regions])]
      : [config.region ?? stackRegion]

  /** @type {Record<string, string>} */
  const s3DeploymentBucket = {}

  /** @type {Record<string, string>} */
  const snsOpsTopic = {}

  await Promise.all(stackRegions.map(async function getDeploymentBucket(region) {
    const stackName = `${settings.stackName}-deployment`
    let result = cloudformationResults.get(`${region}.${stackName}`)
    if (!result) {
      let client = clients.get(region)
      if (!client) {
        client = new CloudFormationClient({ region })
        clients.set(region, client)
      }
      result = await client.send(
        new DescribeStacksCommand({
          StackName: stackName,
        })
      )
      cloudformationResults.set(`${region}.${stackName}`, result)
    }
    for (const output of result?.Stacks?.[0]?.Outputs ?? []) {
      if (output.OutputKey === 'S3DeploymentBucket' && output.OutputValue) {
        s3DeploymentBucket[region] = output.OutputValue
      } else if (output.OutputKey === 'SnsOpsTopic' && output.OutputValue) {
        snsOpsTopic[region] = output.OutputValue
      }
    }
  }))

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

/** @type {import('@starterstack/sam-expand/resolve').FileResolver} */
export default async function getSettings({ template, templateDirectory, argv, region: defaultRegion }) {
  const region = argv[argv.indexOf('--region') + 1] ?? defaultRegion
  const stage = argv[argv.findIndex(x => x.startsWith('Stage='))]

  if (!region) {
    throw new TypeError('missing region')
  }

  if (!stage) {
    throw new TypeError('missing stage')
  }

  const config = await getConfig({ stage: stage.slice('Stage='.length), template, directory: templateDirectory })

  return {
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
    }
  }
}


