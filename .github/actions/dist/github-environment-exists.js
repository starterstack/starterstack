import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
async function c({github:r,context:a,environment:o}){let{owner:n,repo:s}=a.repo;try{let{data:{environments:t=[]}={}}=await r.rest.repos.getAllEnvironments({owner:n,repo:s});return t.some(e=>e.name===o)}catch(t){if(t.status!==404)throw t}try{let{data:t}=await r.rest.repos.listDeployments({owner:n,repo:s});for(let{environment:e}of t)if(e===o)return!0}catch(t){if(t.status!==404)throw t}}export{c as default};
