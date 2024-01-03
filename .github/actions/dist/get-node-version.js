import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
import{readFile as e}from"node:fs/promises";async function t(){return(await e(".envrc","utf-8")).match(/declare -r node_version="([^"]+)/)[1]}export{t as default};
