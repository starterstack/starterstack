// @ts-check

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('@starterstack/sam-expand/resolve').FileResolver} */
// eslint-disable-next-line @typescript-eslint/require-await
export default async function resolve() {
  return {
    get viewerRequestCode() {
      return readFile(
        path.join(__dirname, 'cloudfront-viewer-request.js'),
        'utf8'
      )
    },
    get viewerResponseCode() {
      return readFile(
        path.join(__dirname, 'cloudfront-viewer-response.js'),
        'utf8'
      )
    }
  }
}
