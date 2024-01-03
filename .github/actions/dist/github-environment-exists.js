import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
async function c({github:e,context:a,environment:n}){let{owner:o,repo:s}=a.repo;try{let{data:{environments:t=[]}={}}=await e.rest.repos.getAllEnvironments({owner:o,repo:s});return!!t.find(r=>r.name===n)}catch(t){if(t.status!==404)throw t}try{let{data:t}=await e.rest.repos.listDeployments({owner:o,repo:s});for(let{environment:r}of t)if(r===n)return!0}catch(t){if(t.status!==404)throw t}}export{c as default};
