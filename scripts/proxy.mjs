import process from 'node:process'
import { promisify } from 'node:util'
import inquirer from 'inquirer'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import * as OTPAuth from 'otpauth'
import qrcodeTerminal from 'qrcode-terminal'
import { createProxyMiddleware } from 'http-proxy-middleware'
import express from 'express'
import { exec } from 'node:child_process'
import ora from 'ora'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/* eslint-disable unicorn/no-process-exit */

/** @type {{ stackName: string, stages: string[], stackRootDomain: string }} */
const { stackName, stages, stackRootDomain } = JSON.parse(
  await readFile(
    path.join(__dirname, '..', 'packages', 'settings.json'),
    'utf8'
  )
)

const args = process.argv.slice(2)

if (args.at(0) === '--help') {
  console.log(
    'usage proxy <stage> <localweb true|false> <anonymous true|false>'
  )
  process.exit(0)
}

const { stage } =
  args.length === 0
    ? await inquirer.prompt({
        type: 'list',
        message: 'Stage',
        name: 'stage',
        choices: stages.filter((stage) => !['log', 'backup'].includes(stage))
      })
    : { stage: args[0] }

const { pr } =
  stage === 'feature'
    ? await inquirer.prompt({
        type: 'input',
        message: 'pr number or name',
        name: 'pr',
        default: await getPullRequestRef(),
        validate(value) {
          if (!value) {
            return 'invalid pr'
          }
          return true
        }
      })
    : { pr: '' }

const stageRootUrl = getStageRootUrl(stage)

const { localWeb } =
  args.length === 0
    ? await inquirer.prompt({
        type: 'confirm',
        name: 'localWeb',
        default: false,
        message: 'proxy local web'
      })
    : {
        localWeb: args[1] === 'true'
      }

const url =
  stage === 'feature'
    ? stageRootUrl.replace(/(feature)/, `pr-${pr.replace(/^pr-/i, '')}.$1`)
    : stageRootUrl

const { anonymous } =
  args.length === 0
    ? await inquirer.prompt({
        type: 'confirm',
        message: 'Anonymous user',
        name: 'anonymous',
        default: false
      })
    : { anonymous: args[2] === 'true' }

/** @type {any} */
const app = express()

app.use(function cors(req, res, next) {
  res.append('Access-Control-Allow-Credentials', 'true')
  res.append('Access-Control-Allow-Origin', 'https://studio.apollographql.com')
  res.append('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,OPTIONS,HEAD')
  res.append('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.end()
  } else {
    return next()
  }
})

app.use(
  createProxyMiddleware({
    target: url,
    changeOrigin: true,
    pathFilter(pathname) {
      return (
        (!localWeb || pathname.startsWith('/api')) &&
        !pathname.startsWith('/api/ws')
      )
    },
    on: {
      proxyReq(proxyReq) {
        proxyReq.setHeader('cookie', `token=${token}`)
        proxyReq.removeHeader('origin')
        proxyReq.removeHeader('referer')
      }
    }
  })
)

if (localWeb) {
  app.use(
    createProxyMiddleware({
      pathFilter(pathname) {
        return !pathname.startsWith('/api')
      },
      target: 'http://localhost:3000',
      changeOrigin: true
    })
  )
}

app.use(
  createProxyMiddleware({
    target: url,
    ws: true,
    changeOrigin: true,
    filterPath(pathname) {
      return pathname.startsWith('/api/ws')
    },
    on: {
      proxyReqWs(proxyReq, _, socket) {
        proxyReq.setHeader('cookie', `token=${token}`)
        proxyReq.removeHeader('origin')
        proxyReq.removeHeader('referer')
        socket.on('error', (error) =>
          console.error(
            `\u001B[34mwebsocket error ${error.toString()}\u001B[0m`
          )
        )
      }
    }
  })
)

await new Promise((resolve, reject) => {
  app.listen(5001, () => resolve(true)).on('error', reject)
})

/** @type {string} */ let token
/** @type {string} */ let email

if (!anonymous) {
  const { tokenValue } = await inquirer.prompt({
    type: 'input',
    message: 'Token (to skip login)',
    name: 'tokenValue'
  })

  if (tokenValue) token = tokenValue
  const { loginUser } = token
    ? { loginUser: 'skip login' }
    : await inquirer.prompt({
        type: 'list',
        message: 'Login',
        choices: ['by email', 'skip login'],
        name: 'loginUser'
      })

  if (loginUser !== 'skip login') {
    if (loginUser === 'by email') {
      const { value } = await inquirer.prompt({
        type: 'input',
        message: 'Email',
        name: 'value',
        validate(value) {
          return value && !value.includes('@') ? 'no @' : true
        }
      })
      if (!value) process.exit(0)
      email = value
    }

    if (email) {
      const res = await fetch(`${url}/api/rest/login-by-email`, {
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
        },
        method: 'POST',
        body: new URLSearchParams({
          email
        })
      })

      if (res.status !== 204) {
        throw new Error(`${url} fetch failed: ${res.status}`)
      }

      const { loginUrl } = await inquirer.prompt({
        type: 'input',
        message: 'Login url from mail',
        name: 'loginUrl'
      })

      if (!loginUrl) process.exit(0)

      /** @type {string} */ let location

      {
        const res = await fetch(loginUrl, {
          redirect: 'manual'
        })

        if (![307, 302, 301].includes(res.status)) {
          throw new Error(`${url} fetch failed: ${res.status}`)
        }

        location = new URL(res.headers.get('location'))
        const sessionUrl = new URL(location)
        sessionUrl.pathname = `/api/rest${sessionUrl.pathname}`
        token = await createSession(sessionUrl)
      }
    }
  }
}

async function createSession(sessionUrl) {
  const res = await fetch(sessionUrl)
  const tokenMatch = /token=([^;]*)/
  let token
  if (res.status !== 200) {
    throw new Error(`${sessionUrl} fetch failed: ${res.status}`)
  }
  const { secret } = await res.json()
  if (secret) {
    const totp = new OTPAuth.TOTP({
      issuer: `${stackName} ${pr ? `pr-${pr}` : stage}`,
      label: email,
      secret: OTPAuth.Secret.fromBase32(secret)
    })
    const qrcodeData = await new Promise((resolve) => {
      qrcodeTerminal.generate(totp.toString(), { small: true }, (output) =>
        resolve(output.toString())
      )
    })
    console.log('MFA required')
    console.log(`secret: ${secret}`)
    console.log(qrcodeData)
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { code } = await inquirer.prompt({
      type: 'input',
      message: 'MFA Code',
      name: 'code'
    })

    const res = await fetch(sessionUrl, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
      },
      method: 'POST',
      body: new URLSearchParams({ code })
    })

    if (res.status !== 204) {
      if (res.status > 499) {
        throw new Error(`${sessionUrl} fetch failed: ${res.status}`)
      }
      console.error('\u001B[91mincorrect code\u001B[0m')
      continue
    }
    token = res.headers.get('set-cookie')?.match(tokenMatch)?.[1]
    break
  }
  if (!token) {
    return new Error('failed to get jwt token')
  }
  return token
}

if (!anonymous) {
  console.log(`here is your token which can be used to skip login \n${token}\n`)
}

console.log(
  `
\u001B[32m ┌─────────────────────────────────────────────────────────┐
\u001B[32m │\u001B[0m                                                         \u001B[32m│
\u001B[32m │\u001B[0m ✨ proxy running ✨                                     \u001B[32m│
\u001B[32m │\u001B[0m                                                         \u001B[32m│
\u001B[32m │\u001B[0m - exit                                                  \u001B[32m│
\u001B[32m │\u001B[0m   ctrl^c                                                \u001B[32m│
\u001B[32m │\u001B[0m                                                         \u001B[32m│
\u001B[32m │\u001B[0m - graphql                                               \u001B[32m│
\u001B[32m │\u001B[0m   https://studio.apollographql.com/sandbox/explorer     \u001B[32m│
\u001B[32m │\u001B[0m   http: http://localhost:5001/api/graphql               \u001B[32m│
\u001B[32m │\u001B[0m   ws: ws://localhost:5001/api/ws/graphql                \u001B[32m│
\u001B[32m │\u001B[0m                                                         \u001B[32m│
\u001B[32m │\u001B[0m - rest                                                  \u001B[32m│
\u001B[32m │\u001B[0m   http: http://localhost:5001/api/rest                  \u001B[32m│
\u001B[32m │\u001B[0m                                                         \u001B[32m│
\u001B[32m │\u001B[0m - all traffic                                           \u001B[32m│
\u001B[32m │\u001B[0m   http: http://localhost:5001                           \u001B[32m│
\u001B[32m │\u001B[0m                                                         \u001B[32m│
\u001B[32m └─────────────────────────────────────────────────────────┘\u001B[0m`
)

async function getPullRequestRef() {
  const loadingStage = ora({ text: 'get stage', color: 'gray' }).start()
  const run = promisify(exec)

  try {
    const { stdout } = await run(`
      git ls-remote --refs origin | \
      grep $(git rev-parse @{push}) | \
      grep -oE 'pull/[0-9]+' | \
      sed 's|^pull/||g'`)
    const ref = stdout.replaceAll(/[\n\r]/g, '')
    if (ref) {
      return ref
    }
  } catch {
    // eslint-disable-next-line no-empty
  } finally {
    loadingStage.stop()
  }
}

function getStageRootUrl(stage) {
  if (stage === 'dev') {
    return `https://dev.${stackRootDomain}`
  } else if (stage === 'prod') {
    return `https://${stackRootDomain}`
  } else {
    return `https://${stage}.feature.${stackRootDomain}`
  }
}
