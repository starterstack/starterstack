import { readFile } from 'node:fs/promises'
export default async function () {
  const env = await readFile('.envrc', 'utf8')
  return env.match(/declare -r node_version="v?([^"]+)/)[1]
}
