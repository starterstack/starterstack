#!/usr/bin/env node

import process from 'node:process'
import { writeFile, readdir, readFile, lstat } from 'node:fs/promises'
import path from 'node:path/posix'
import { EOL } from 'node:os'

const managers = {
  'package.json': 'npm',
  Dockerfile: 'docker',
  'requirements.txt': 'pip',
  Gemfile: 'bundler'
}

function template({ directory, ecosystem }) {
  return `  - package-ecosystem: ${ecosystem}
    directory: '${directory}'
    schedule:
      interval: daily
    open-pull-requests-limit: 10
    labels:
      - dependencies
    ignore:
      - dependency-name: '@aws-sdk/*'
      - dependency-name: 'aws-xray-sdk-core'
      - dependency-name: '@types/*'`
}

async function* walk(directory) {
  const files = await readdir(directory)
  for (const file of files) {
    if (file === '.aws-sam') continue
    if (file === 'node_modules') continue
    if (file === 'bundle') continue
    if (file === '.home') continue
    if (file === '.serverless') continue
    if (file === '.git') continue
    if (file === 'package.json') {
      if (directory === process.cwd()) continue
      const packageJson = await readFile(path.join(directory, file), 'utf8')
      if (!packageJson.includes('"dependencies": {')) {
        continue
      }
    }
    if (managers[file]) {
      yield path.relative(process.cwd(), path.join(directory, file))
    }
    const fileOrDirectory = await lstat(path.join(directory, file))
    if (fileOrDirectory.isDirectory()) {
      yield* walk(path.join(directory, file))
    }
  }
}

const currentYml = await readFile('.github/dependabot.yml', 'utf8').catch(
  () => ''
)

const files = []

for await (const file of walk(process.cwd())) {
  files.push(file)
}

await writeFile(
  '.github/dependabot.yml',
  `version: 2
updates:
${template({ directory: '/', ecosystem: 'github-actions' })}
${template({ directory: '/', ecosystem: 'npm' })}
${files
  .sort()
  .map((file) =>
    template({
      directory: path.dirname(file),
      ecosystem: managers[path.basename(file)]
    })
  )
  .join(EOL)}
`
)

if ((await readFile('.github/dependabot.yml', 'utf8')) !== currentYml) {
  console.log('\u001B[91m.github/dependabot.yml changed please commit\u001B[0m')
}
