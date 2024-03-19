#!/usr/bin/env node

// @ts-check

import { readdir, stat, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import stackStageConfig from '../packages/stack-stage-config.mjs'
import { yamlParse } from 'yaml-cfn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const exports = getExports()

const packageDirectories = await readdir(path.join(__dirname, '..', 'packages'))
const packages = packageDirectories.filter((file) => !file.includes('.'))

const dependencies = await Promise.all(
  packages.map(
    /** @returns Promise<{{ file: string, dependencies: string[] } | undefined} */
    async function getDependencies(file) {
      const templatePath = path.join(
        __dirname,
        '..',
        'packages',
        file,
        'template.yaml'
      )
      if (!(await stat(templatePath).catch(() => false))) {
        return
      }

      const template = yamlParse(await readFile(templatePath, 'utf8'))
      /** @type {import('@starterstack/sam-expand/plugins/parameter-overrides').Schema | undefined } */
      const parameterOverrides =
        template?.Metadata?.expand?.config?.parameterOverrides
      const stackStageConfigParameterOverrides =
        parameterOverrides?.filter(
          (x) => x.location === '../stack-stage-config.mjs'
        ) ?? []
      const dependencies = []
      if (file !== 'deployment') {
        dependencies.push('deployment')
      }
      for (const parameterOverrides of stackStageConfigParameterOverrides ??
        []) {
        for (const override of parameterOverrides.overrides) {
          /** @type {string} */
          const exportName = override.exportName

          /** @type {string | undefined} */
          const stack = exports[exportName]
          if (stack) {
            dependencies.push(stack)
          }
        }
      }
      return {
        file,
        dependencies: [...new Set(dependencies)]
      }
    }
  )
)

/** @type {{ file: string, dependencies: string[] }[]} */
const templateDependencies = []
for (const dependency of dependencies) {
  if (dependency) {
    templateDependencies.push(dependency)
  }
}

const readme = await readFile(path.join(__dirname, '..', 'README.md'), 'utf8')
const readmeLines = readme.split(/\n/)

const mermaidIndexStart = readmeLines.indexOf('```mermaid')
const mermaidIndexEnd = readmeLines.slice(mermaidIndexStart).indexOf('```')

readmeLines.splice(mermaidIndexStart + 1, mermaidIndexEnd)
readmeLines[mermaidIndexStart] = `\`\`\`mermaid
  graph LR;
${templateDependencies
  .flatMap(({ file, dependencies }) =>
    dependencies.map((dependency) => `    ${file} --- ${dependency}`)
  )
  .join('\n')}
\`\`\``

await writeFile(path.join(__dirname, '..', 'README.md'), readmeLines.join('\n'))

/**
 * @returns {Record<string, string>}
 **/
function getExports() {
  /** @type {Record<string, string>} */
  const inputs = { cloudFrontWafACL: 'stage' }
  const matchGet = /^\s*get\s*([^()]+)\(\)\s*{\s*$/
  const matchOutput = /^\s*return\s*get(.*)Output\s*\(/
  const matchEnd = /^\s*},?\s*$/
  let exportName
  const lines = stackStageConfig.toString().split(/[\n\r]/)
  for (const line of lines) {
    if (exportName) {
      const output = line.match(matchOutput)
      if (output) {
        inputs[exportName] = String(output.at(1)).toLowerCase()
      } else {
        const end = line.match(matchEnd)
        if (end) {
          exportName = ''
        }
      }
    } else {
      const get = line.match(matchGet)
      if (get) {
        exportName = get.at(1)
      }
    }
  }
  return inputs
}
