import process from 'node:process'
import { promisify } from 'node:util'
import inquirer from 'inquirer'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { exec } from 'node:child_process'
import roleMapping from '../packages/shared/role-mapping.js'
import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { ListTablesCommand } from '@aws-sdk/client-dynamodb'
import { createRequire } from 'node:module'
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'

/* eslint-disable unicorn/no-process-exit */

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

if (!process.env.AWS_ACCESS_KEY_ID) {
  console.error('\u001B[91mmissing aws credentials\u001B[0m')
  process.exit(1)
}

let stackTableName

const sts = new STSClient({ region: 'us-east-1' })
const { Account: accountId } = await sts.send(new GetCallerIdentityCommand())
const { awsAccounts, regions } = require('../packages/settings.json')

const awsAccount = awsAccounts[accountId]

if (!awsAccount) {
  console.error(
    `\u001B[91maccount ${accountId} not found in ../packages/settings.json\u001B[0m`
  )
  process.exit(0)
}

const region = regions[awsAccount.stage]
process.env.AWS_REGION = region
process.env.AWS_DEFAULT_REGION = region

const { default: dynamodb } = await import(
  path.join(__dirname, '..', 'packages', 'shared', 'dynamodb.js')
)

const { TableNames: tableNames = [] } = await dynamodb.send(
  new ListTablesCommand({})
)

const stackTables = tableNames.filter((x) => x.includes('StackTable'))
if (stackTables.length === 0) {
  console.error('\u001B[91mno stack tables found\u001B[0m')
  process.exit(1)
} else if (stackTables.length > 1) {
  const prRef = await getPullRequestRef()
  if (prRef > 0) {
    const stage = `pr-${prRef}`
    const prTable = stackTables.find(function findPullRequestStackTable(table) {
      return table.includes(stage)
    })
    if (prTable) {
      stackTableName = prTable
    }
  }
  if (!stackTableName) {
    const { table } = await inquirer.prompt({
      type: 'list',
      name: 'table',
      choices: stackTables,
      message: 'DynamoDB Stack Table'
    })
    if (!table) {
      process.exit(0)
    }

    stackTableName = table
  }
} else {
  stackTableName = stackTables[0]
}

const stage = stackTableName.match(/dynamodb-(.*)-DynamoDBStackTable/)[1]

const { email } = await inquirer.prompt({
  type: 'input',
  message: 'Email',
  name: 'email',
  validate(value) {
    return value && !value.includes('@') ? 'no @' : true
  }
})

if (!email) {
  console.error('\u001B[91mNo email\u001B[0m')
  process.exit(0)
}

const { addRoles } = await inquirer.prompt({
  type: 'confirm',
  message: 'Add roles',
  default: true,
  name: 'addRoles'
})

const { roles } =
  (addRoles &&
    (await inquirer.prompt({
      type: 'checkbox',
      message: 'Roles',
      name: 'roles',
      choices: Object.values(roleMapping)
        .map((name) => ({ name }))
        .filter(({ name }) => name !== 'notauthorized'),
      validate(answer) {
        if (answer.length === 0) {
          return 'You need to select at least one role'
        }

        return true
      }
    }))) ??
  {}

const roleEntries = Object.entries(roleMapping)

const roleSet =
  addRoles &&
  new Set(
    (roles.includes('super')
      ? Object.keys(roleMapping).map(Number).filter(Boolean)
      : roles.map((role) =>
          Number(
            roleEntries.find(([, value]) => value === role.toLowerCase())[0]
          )
        )
    ).filter(Boolean)
  )

const hash = crypto.createHash('sha512').update(email).digest('hex')

await dynamodb.send(
  new UpdateCommand({
    TableName: stackTableName,
    Key: {
      pk: `user#${hash}`,
      sk: `user#${hash}`
    },
    UpdateExpression: 'set #role = :role, #type = :type, #email = :email',
    ExpressionAttributeNames: {
      '#role': 'role',
      '#type': 'type',
      '#email': 'email'
    },
    ExpressionAttributeValues: {
      ':role': roleSet,
      ':type': 'user',
      ':email': email
    },
    ReturnValues: 'NONE'
  })
)

console.log(
  `✨ user upserted to stage ${stage} ${JSON.stringify(
    {
      id: `user#{hash}`,
      ...(email && { email }),
      ...(addRoles && {
        roles: [...roleSet]
      })
    },
    undefined,
    2
  )}✨`
)

async function getPullRequestRef() {
  const run = promisify(exec)

  try {
    const { stdout } = await run(`
      git ls-remote --refs origin | \
      grep $(git rev-parse @{push}) | \
      grep -oE 'pull/[0-9]+' | \
      sed 's|^pull/||g'`)
    const ref = stdout.replaceAll(/[\n\r]/g, '')
    if (ref) {
      return Number(ref)
    }
  } catch {
    // eslint-disable-next-line no-empty
  }
}
