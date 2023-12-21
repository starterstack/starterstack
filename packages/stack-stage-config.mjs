#!/usr/bin/env node

// @ts-check

import inquirer from 'inquirer'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import * as parse from '@starterstack/sam-expand/parse'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { stackName } = JSON.parse(
  await readFile(path.join(__dirname, 'settings.json'), 'utf8')
)

/** @type {import('@starterstack/sam-expand/plugins').Lifecycles} */
export const lifecycles = ['pre:expand']

/** @type {import('@starterstack/sam-expand/plugins').PluginSchema<{ region?: string, 'suffixStage': boolean, 'configEnv'?: string, stage?: string }>} */
export const schema = {
  type: 'object',
  properties: {
    region: {
      type: 'string',
      nullable: true
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
    }
  },
  required: ['suffixStage'],
  additionalProperties: false
}

export const metadataConfig = 'stackStageConfig'

/** @type {import('@starterstack/sam-expand/plugins').Plugin} */
export const lifecycle = async function stackStageConfig({ command, argv, region, template, log }) {
  if (command === 'package') {
    throw new TypeError ('unsupported, use sam-expand deploy instead')
  }
  if (!process.env.CI && (!region || argv.length === 0)) {
    const { stage } = await inquirer.prompt({ name: 'stage', message: 'stage' })
    if (!stage) {
      throw new TypeError('missing stage')
    }
    const { region } = await inquirer.prompt({ name: 'region', message: 'region' })
    if (!region) {
      throw new TypeError('missing region')
    }
    const config = await getConfig({ stage, region, template })
    if (['build', 'deploy'].includes(command)) {
      argv.push(...['--parameter-overrides', `Stack=${stackName}`, `Stage=${stage}`])
    }
    if (['deploy', 'delete'].includes(command)) {
      argv.push(...['--stack-name', config.stackName])
    }
    if (['build', 'deploy', 'delete'].includes(command)) {
      argv.push(...['--region', config.region])
    }
    log('applied stack stage config %O', { config, argv })
  }
}

/**
 * @param {{ stage: string, region: string, template: any }} options
 * @returns {Promise<{ stackName: string, stage: string, region: string }>}
 **/
export async function getConfig({ stage, region, template }) {
  if (!template) {
    const templateFile = path.join(process.cwd(), 'template.yaml')
    try {
      await stat(path.join(process.cwd(), 'template.yaml'))
    } catch {
      throw new TypeError('no template.yaml found')
    }
    template = await parse.template(templateFile)
  }

  const config = template.Metadata.expand.config.stackStageConfig
  const name = config.name ?? path.basename(process.cwd())
  const stackRegion = config.region ?? region
  const stackStage = config.stage ?? stage
  const cloudformationStackName = config.suffixStage ? `${stackName}-${name}-${stackStage}` : `${stackName}-${name}`

  return {
    stackName: cloudformationStackName,
    stage: stackStage,
    region: stackRegion
  }
}
