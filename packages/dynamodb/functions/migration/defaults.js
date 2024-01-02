import process from 'node:process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const { STACK_NAME: stackName, STAGE: stage } = process.env
export const blobPath = path.join(__dirname, '.include-lambda-blob-files')
