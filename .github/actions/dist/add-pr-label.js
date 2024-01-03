import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
async function n({github:s,context:e,label:a,issueNumber:r}){let{owner:u,repo:l}=e.repo;await s.rest.issues.addLabels({issue_number:r||e.payload.pull_request.number,owner:u,repo:l,labels:[a]})}export{n as default};
