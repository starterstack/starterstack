#!/usr/bin/env node

// @ts-check

import process from 'node:process'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const isMain = import.meta.url === `file://${process.argv[1]}`

if (isMain) {
  const [root, context = '', packagesRoot] = process.argv.slice(2)
  console.log(await calculateHash({ root, context, packagesRoot }))
}

/**
 * @param {{ root: string, context?: string, packagesRoot: string, ignoreRoot?: string }} options
 * returns {string}
 **/

export default async function calculateHash({
  root,
  context = '',
  packagesRoot,
  ignoreRoot = '.'
}) {
  if (!root) throw new TypeError('missing root directory')

  const globalFileHash = packagesRoot
    ? await getGlobalFileHash(packagesRoot)
    : ''

  const { stdout: gitOutput } = await promisify(exec)(
    `
    git status --ignored --porcelain ${ignoreRoot} | grep '^!! ' | sed 's/^!! //g'
  `,
    { shell: 'bash' }
  )

  const rootDirectory = path.resolve(path.join(packagesRoot, '..'))

  /** @type {string[]} */
  const ignoredFiles = (gitOutput.split(/\n/).filter(Boolean) ?? []).map(
    function absolutePath(file) {
      return path.resolve(rootDirectory, path.normalize(file))
    }
  )

  /** @type {string[]} */
  const files = await getFiles(path.resolve(root), ignoredFiles)

  const fileDependenciesHash = await getFileDependenciesHash({
    files,
    packagesRoot
  })

  const hashes = await Promise.all(
    files.map(async (file) => {
      const content = await fs.readFile(file, 'utf8')
      return crypto
        .createHash('sha512')
        .update(content + globalFileHash + fileDependenciesHash)
        .digest('hex')
    })
  )

  const hash = crypto
    .createHash('sha1')
    .update(context + globalFileHash + hashes.toString())
    .digest('hex')

  return hash
}

/**
 * @param {string} root
 * @param {string[]} ignoredFiles
 * @returns {Promise<string[]>}
 **/

async function getFiles(root, ignoredFiles) {
  const files = []
  for (const file of await fs.readdir(root)) {
    if (ignoredFiles.includes(path.join(root, file))) {
      continue
    }
    // for symlink functions we need to explicitly exclude
    if (file === 'node_modules' || file === '.build_hash') {
      continue
    }
    const filePath = path.join(root, file)
    const stat = await fs.stat(filePath)
    if (stat.isFile()) {
      files.push(filePath)
    } else if (stat.isDirectory()) {
      for (const file of await getFiles(filePath, ignoredFiles)) {
        files.push(file)
      }
    }
  }
  return files.sort()
}

/**
 * @param {{ files: string[], packagesRoot: string }} options
 * @returns {Promise<string>}
 **/

async function getFileDependenciesHash({ files, packagesRoot }) {
  const allDependencies = await Promise.all(
    files
      .filter((x) => path.basename(x) === 'package.json')
      .map(async function getRelativeDependencies(file) {
        const { dependencies = {} } = JSON.parse(
          await fs.readFile(file, 'utf8')
        )
        return Object.values(dependencies)
          .filter((x) => x.startsWith('file:'))
          .map((x) => {
            return new URL(x, pathToFileURL(path.dirname(file) + '/')).pathname
          })
      })
  )
  const fileDependencies = [
    ...new Set(allDependencies.flat().filter(Boolean))
  ].sort()

  const fileDependencyHashes = await Promise.all(
    fileDependencies.map((root) =>
      calculateHash({ root, packagesRoot, ignoreRoot: root })
    )
  )

  return fileDependencies.length > 0 ? fileDependencyHashes.join('') : ''
}

/**
 * @param {string} packagesRoot
 * @returns {Promise<string>}
 **/

async function getGlobalFileHash(packagesRoot) {
  const files = [
    'stack-stage-config.mjs',
    'git.mjs',
    'hash.mjs',
    'npm-copy.sh',
    'generate-cloudwatch-alarms.mjs',
    'settings.json'
  ]

  const hashes = await Promise.all(
    files.sort().map(async (file) => {
      const content = await fs.readFile(path.join(packagesRoot, file), 'utf8')
      return crypto.createHash('sha512').update(content).digest('hex')
    })
  )

  return crypto.createHash('sha1').update(hashes.toString()).digest('hex')
}
