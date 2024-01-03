import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
async function p({github:t,context:s,environment:o}){let{owner:r,repo:a}=s.repo;try{await t.rest.repos.deleteAnEnvironment({owner:r,repo:a,environment_name:o});return}catch(e){if(e.status!==404)throw e}for(;;){let{data:e}=await t.rest.repos.listDeployments({owner:r,repo:a,environment:o});if(e.length===0)break;for(let{id:l}of e)try{await t.rest.repos.createDeploymentStatus({owner:r,repo:a,deployment_id:l,state:"failure"}),await t.rest.repos.deleteDeployment({owner:r,repo:a,deployment_id:l})}catch(n){if(n.status!==404)throw n}}if(s.payload.pull_request)try{await t.rest.issues.removeLabel({owner:r,repo:a,issue_number:s.payload.pull_request.number,name:"feature deploy"})}catch(e){if(e.status!==404)throw e}}export{p as default};
