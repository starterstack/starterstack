import { readFile } from 'node:fs/promises'
export default async function () {
  const env = await readFile('.envrc', 'utf-8')
  return env.match(/declare -r node_version="([^"]+)/)[1]
}
