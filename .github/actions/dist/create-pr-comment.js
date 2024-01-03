import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
async function o({github:r,context:e,body:s,issueNumber:u}){let{owner:a,repo:n}=e.repo;await r.rest.issues.createComment({issue_number:u||e.payload.pull_request.number,owner:a,repo:n,body:s})}export{o as default};
