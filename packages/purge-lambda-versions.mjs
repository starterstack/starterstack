#!/usr/bin/env node

// @ts-check

import logInfo from '@starterstack/sam-expand/log'
import {
  CloudFormationClient,
  DescribeStackResourceCommand,
  ListStackResourcesCommand
} from '@aws-sdk/client-cloudformation'

import {
  LambdaClient,
  ListVersionsByFunctionCommand,
  ListAliasesCommand,
  DeleteFunctionCommand
} from '@aws-sdk/client-lambda'

/** @type {import('@starterstack/sam-expand/plugins').Lifecycles} */
export const lifecycles = ['post:deploy']

/** @typedef {{ keep: number }} Schema */

/** @type {import('@starterstack/sam-expand/plugins').PluginSchema<Schema>} */
export const schema = {
  type: 'object',
  properties: {
    keep: {
      type: 'number',
      nullable: false
    }
  },
  required: ['keep'],
  additionalProperties: false
}

export const metadataConfig = 'purgeLambdaVersions'

/** @type {import('@starterstack/sam-expand/plugins').Plugin} */
export const lifecycle = async function purgeLambdaVersion({
  template,
  argvReader
}) {
  const region = argvReader('region')

  if (!region) {
    throw new TypeError('missing region')
  }

  const stackName = argvReader('stack-name')

  if (!stackName) {
    throw new TypeError('missing stack name')
  }

  const cloudformation = new CloudFormationClient({ region })
  const lambda = new LambdaClient({ region })
  /** @type {Schema} */
  const config = template.Metadata.expand.config[metadataConfig]

  for await (const logicalId of listLambdaResources({
    client: cloudformation,
    stackName
  })) {
    await purgeLambdaFunctionVersions({
      keep: config.keep,
      cloudformation,
      lambda,
      logicalId,
      stackName
    })
  }
}

/**
 * @param {{ keep: number, cloudformation: CloudFormationClient, lambda: LambdaClient, logicalId: string, stackName: string }} options
 * @returns {Promise<void>}
 **/
async function purgeLambdaFunctionVersions({
  keep,
  cloudformation,
  lambda,
  logicalId,
  stackName
}) {
  const { StackResourceDetail: { PhysicalResourceId: resourceId = '' } = {} } =
    await cloudformation.send(
      new DescribeStackResourceCommand({
        StackName: stackName,
        LogicalResourceId: logicalId
      })
    )
  if (!resourceId) {
    // Could be a resource with a Condition
    return
  }

  const versions = await listLambdaVersions({
    client: lambda,
    name: resourceId
  })
  const aliases = await listLambdaAliases({ client: lambda, name: resourceId })

  const purge = versions.slice(keep)

  await Promise.all(
    purge.map(
      (version) =>
        !aliases.includes(version) &&
        deleteLambdaFunction({ client: lambda, name: resourceId, version })
    )
  )
}

/**
 * @param {{ client: LambdaClient, name: string }} options
 * @returns {Promise<number[]>}
 **/

async function listLambdaVersions({ client, name }) {
  let lastMarker
  /** @type {number[]} */
  const result = []
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { NextMarker: nextMarker, Versions: versions = [] } =
      await client.send(
        new ListVersionsByFunctionCommand({
          FunctionName: name,
          ...(lastMarker && { NextMarker: lastMarker })
        })
      )
    if (versions.length > 0) {
      for (const version of versions) {
        if (version.Version && version.Version !== '$LATEST') {
          result.push(Number(version.Version))
        }
      }
    }
    if (nextMarker) {
      lastMarker = nextMarker
    } else {
      break
    }
  }
  return result.sort((a, b) => b - a)
}

/**
 * @param {{ client: LambdaClient, name: string }} options
 * @returns {Promise<number[]>}
 **/

async function listLambdaAliases({ client, name }) {
  let lastMarker
  /** @type {number[]} */
  const result = []
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { NextMarker: nextMarker, Aliases: aliases = [] } = await client.send(
      new ListAliasesCommand({
        FunctionName: name,
        ...(lastMarker && { NextMarker: lastMarker })
      })
    )
    if (aliases.length > 0) {
      for (const alias of aliases) {
        if (alias.FunctionVersion) {
          result.push(Number(alias.FunctionVersion))
        }
      }
    }
    if (nextMarker) {
      lastMarker = nextMarker
    } else {
      break
    }
  }
  return result
}

/**
 * @param {{ client: LambdaClient, name: string, version: number }} options
 * @returns {Promise<void>}
 **/

async function deleteLambdaFunction({ client, name, version }) {
  logInfo('purging lambda %O', { name, version })
  await client.send(
    new DeleteFunctionCommand({
      FunctionName: `${name}:${version}`
    })
  )
}

async function* listLambdaResources({ client, stackName }) {
  let lastToken
  while (true) {
    /** @type {import('@aws-sdk/client-cloudformation').ListStackResourcesCommandOutput} */
    const {
      NextToken: nextToken,
      StackResourceSummaries: stackResourceSummaries
    } = await client.send(
      new ListStackResourcesCommand({
        StackName: stackName,
        ...(lastToken && { NextToken: lastToken })
      })
    )
    for (const {
      ResourceType: resourceType,
      LogicalResourceId: logicalResourceId
    } of stackResourceSummaries ?? []) {
      if (resourceType === 'AWS::Lambda::Function') {
        yield String(logicalResourceId)
      }
    }
    if (nextToken) {
      lastToken = nextToken
    } else {
      break
    }
  }
}
