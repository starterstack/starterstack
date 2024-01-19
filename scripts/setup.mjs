#!/usr/bin/env node

import process from 'node:process'
import inquirer from 'inquirer'
import fs from 'node:fs'
import { promisify } from 'node:util'
import { exec } from 'node:child_process'
import github from '@actions/github'
import crypto from 'node:crypto'
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'

import updateRepoSecret from '../.github/actions/dist/update-repo-secret.js'

const { stdout: origin } = await promisify(exec)('git remote get-url origin')

const stages = ['dev', 'feature', 'prod', 'log', 'backup']

const [owner, repo] = origin
  .replaceAll(/[\n\r]/g, '')
  .match(/github.com.([^.]+).git/)[1]
  .split('/')

const defaults = JSON.parse(
  await fs.promises.readFile(
    new URL('../packages/settings.json', import.meta.url)
  )
)

const { updateSecretsOnly } = await inquirer.prompt({
  type: 'confirm',
  message: 'Setup GitHub secrets only',
  default: false,
  name: 'updateSecretsOnly'
})

if (updateSecretsOnly) {
  await updateGithubSecrets()
  process.exit(0)
}

const { stackName } = await inquirer.prompt({
  type: 'input',
  message: 'Stack name',
  default: defaults.stackName,
  name: 'stackName',
  validate: (f) => !!f
})

const { stackDisplayName } = await inquirer.prompt({
  type: 'input',
  message: 'Stack display name',
  default:
    defaults.stackDisplayName ??
    defaults.stackName?.replace(/[a-z]*/gi, function titleize(word) {
      return word.slice(0, 1).toUpperCase() + word.slice(1)
    }) ??
    '',
  name: 'stackDisplayName',
  validate: (f) => !!f
})

const { rootDomain } = await inquirer.prompt({
  type: 'input',
  message: 'Route 53 root domain',
  default: defaults.rootDomain,
  name: 'rootDomain',
  validate: (f) => /^[a-z]+[.a-z]+$/.test(f)
})

const { stackRootDomain } = await inquirer.prompt({
  type: 'input',
  default:
    defaults.stackRootDomain ??
    `${stackName.toLowerCase().replaceAll(/[^a-z]/g, '')}.${rootDomain}`,
  message: 'Stack root domain',
  name: 'stackRootDomain',
  validate: (f) => !!f
})

const priceClassKeys = {
  'US and Europe': 'usAndEurope',
  'US, Europe, Hong Kong, Singapore, and Japan':
    'usEuropeHongKongSingaporeAndJapan',
  all: 'all'
}

const currentPriceClassValue = Object.entries(priceClassKeys).find(
  ([, value]) => value === defaults.priceClassKey
)[0]

const { priceClass } = await inquirer.prompt({
  type: 'list',
  name: 'priceClass',
  message: 'What price class should our CloudFront distribution use',
  choices: [
    currentPriceClassValue,
    ...[
      'US and Europe',
      'US, Europe, Hong Kong, Singapore, and Japan',
      'all'
    ].filter((value) => value !== currentPriceClassValue)
  ].filter(Boolean)
})

const priceClassKey = priceClassKeys[priceClass]

const { captureUserLanguageAndDevice } = await inquirer.prompt({
  type: 'confirm',
  message:
    'Do we need CloudFront to expose users language and device in http headers send to our origins',
  name: 'captureUserLanguageAndDevice',
  default: false
})

const { defaultLogRetentionInDays } = await inquirer.prompt({
  type: 'list',
  name: 'defaultLogRetentionInDays',
  choices: [
    defaults.defaultLogRetentionInDays,
    ...[
      1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827,
      2192, 2557, 2922, 3288, 3653
    ].filter((value) => value !== defaults.defaultLogRetentionInDays)
  ],
  message: 'Default log group retention in days'
})

const allRegions = [
  'af-south-1',
  'ap-east-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-south-1',
  'ap-south-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'ca-central-1',
  'eu-central-1',
  'eu-central-2',
  'eu-north-1',
  'eu-south-1',
  'eu-south-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'me-central-1',
  'me-south-1',
  'sa-east-1',
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2'
]

const { accountPerStage } = await inquirer.prompt({
  type: 'confirm',
  message: 'AWS account per stage',
  default: defaults.accountPerStage,
  name: 'accountPerStage'
})

if (!accountPerStage) {
  for (const stage of ['backup', 'log']) {
    stages.splice(stages.indexOf(stage, 1))
  }
  console.error(
    `\u001B[93mSingle account is only recommended for POCs and not for production ready projects\u001B[0m`
  )
}

const regions = {}

for (const stage of stages) {
  const { value } = await inquirer.prompt({
    type: 'list',
    name: 'value',
    message: `${stage} region`,
    choices: [
      defaults.regions[stage],
      ...allRegions.filter((stage) => stage !== defaults.regions[stage])
    ].filter(Boolean)
  })
  regions[stage] = value
}

const awsAccounts = defaults.awsAccounts ?? {}

if (accountPerStage) {
  for (const [key, value] of Object.entries(awsAccounts)) {
    if (value.stage === '*') {
      delete awsAccounts[key]
    }
  }

  for (const stage of stages) {
    const [defaultAccountId, defaultAccountSettings] =
      Object.entries(awsAccounts).find(([, value]) => value.stage === stage) ??
      []
    const { account } = await inquirer.prompt({
      type: 'number',
      name: 'account',
      default: defaultAccountId,
      message: `AWS Account for ${stage}`
    })

    if (!account) continue

    if (defaultAccountId) {
      delete awsAccounts[defaultAccountId]
    }

    const { cloudwatchAlertsEnabled } = await inquirer.prompt({
      type: 'confirm',
      name: 'cloudwatchAlertsEnabled',
      default: defaultAccountSettings?.cloudwatchAlertsEnabled ?? true,
      message: `Enable CloudWatch alarms for ${stage}`
    })
    if (stage === 'log') {
      awsAccounts[account] = {
        stage,
        wafEnabled: false,
        isLogAccount: true,
        isBackupAccount: false,
        cloudwatchAlertsEnabled
      }
    } else if (stage === 'backup') {
      awsAccounts[account] = {
        stage,
        wafEnabled: false,
        isLogAccount: false,
        isBackupAccount: true,
        cloudwatchAlertsEnabled
      }
    } else {
      const { wafEnabled } = await inquirer.prompt({
        type: 'confirm',
        name: 'wafEnabled',
        default: defaultAccountSettings?.wafEnabled ?? true,
        message: `Enable WAF for ${stage}`
      })
      const { cloudfrontServerTiming } = await inquirer.prompt({
        type: 'number',
        name: 'cloudfrontServerTiming',
        default: defaultAccountSettings?.cloudfrontServerTiming ?? 0,
        message: `CloudFront server timing sample rate (0-100) for ${stage}`,
        /** @param {string} f */
        validate: (f) => Number(f) >= 0 && Number(f) <= 100
      })
      const { dynamodbPointInTimeDailyS3ExportsEnabled } =
        await inquirer.prompt({
          type: 'confirm',
          name: 'dynamodbPointInTimeDailyS3ExportsEnabled',
          default:
            defaultAccountSettings?.dynamodbPointInTimeDailyS3ExportsEnabled ??
            true,
          message: `Enable daily point in time DynamoDB exports to s3 for ${stage}`
        })
      awsAccounts[account] = {
        stage,
        wafEnabled,
        isLogAccount: false,
        isBackupAccount: false,
        dynamodbPointInTimeDailyS3ExportsEnabled,
        cloudwatchAlertsEnabled,
        cloudfrontServerTiming
      }
    }
  }
} else {
  const [defaultAccountId, defaultAccountSettings] =
    Object.entries(awsAccounts)?.slice(-1)?.[0] ?? []
  const { account } = await inquirer.prompt({
    type: 'number',
    name: 'account',
    default: defaultAccountId,
    message: 'AWS Account'
  })
  const { cloudwatchAlertsEnabled } = await inquirer.prompt({
    type: 'confirm',
    name: 'cloudwatchAlertsEnabled',
    default: defaultAccountSettings?.cloudwatchAlertsEnabled ?? true,
    message: 'Enable CloudWatch alarms'
  })
  const { wafEnabled } = await inquirer.prompt({
    type: 'confirm',
    name: 'wafEnabled',
    default: defaultAccountSettings?.wafEnabled ?? true,
    message: 'Enable WAF'
  })
  const { cloudfrontServerTiming } = await inquirer.prompt({
    type: 'number',
    name: 'cloudfrontServerTiming',
    default: defaultAccountSettings?.cloudfrontServerTiming ?? 0,
    message: 'CloudFront server timing sample rate (0-100)',
    /** @param {string} f */
    validate: (f) => Number(f) >= 0 && Number(f) <= 100
  })

  const { dynamodbPointInTimeDailyS3ExportsEnabled } = await inquirer.prompt({
    type: 'confirm',
    name: 'dynamodbPointInTimeDailyS3ExportsEnabled',
    default:
      defaultAccountSettings?.dynamodbPointInTimeDailyS3ExportsEnabled ?? true,
    message: `Enable daily point in time DynamoDB exports to s3`
  })
  for (const key of Object.keys(awsAccounts)) {
    delete awsAccounts[key]
  }
  awsAccounts[account] = {
    wafEnabled,
    isLogAccount: false,
    isBackupAccount: false,
    cloudwatchAlertsEnabled,
    cloudfrontServerTiming,
    dynamodbPointInTimeDailyS3ExportsEnabled,
    stage: '*'
  }
}

const settings =
  JSON.stringify(
    {
      stackName,
      stackDisplayName,
      rootDomain,
      stackRootDomain,
      priceClassKey,
      captureUserLanguageAndDevice,
      owner,
      repo,
      defaultLogRetentionInDays,
      accountPerStage,
      regions,
      stages,
      awsAccounts
    },
    undefined,
    2
  ) + '\n'

const { ok } = await inquirer.prompt({
  type: 'confirm',
  message: `Save changes\n${settings}`,
  default: true,
  name: 'ok'
})

if (ok) {
  const readmeData = await fs.promises.readFile('README.md', 'utf8')
  const readme = readmeData.split(/[\n\r]/)
  const logIndex = readme.findIndex((x) => x.startsWith('[![log]'))
  if (accountPerStage) {
    if (logIndex === -1) {
      const releaseIndex = readme.findIndex((x) => x.startsWith('[![release]'))
      await fs.promises.writeFile(
        'README.md',
        [
          ...readme.slice(0, releaseIndex + 1),
          `[![log](https://github.com/${owner}/${repo}/actions/workflows/log.yml/badge.svg)](https://github.com/${owner}/${repo}/actions/workflows/log.yml)`,
          `[![backup](https://github.com/${owner}/${repo}/actions/workflows/backup.yml/badge.svg)](https://github.com/${owner}/${repo}/actions/workflows/backup.yml)`,
          ...readme.slice(releaseIndex + 1)
        ].join('\n')
      )
    }
    try {
      for (const workflow of ['log', 'backup']) {
        await fs.promises.stat(`./.github/workflows/${workflow}.yml`)
      }
    } catch {
      console.log(`.github/workflows/log & backup.yml are missing
locate the git commit removing them and revert it.`)
    }
  } else {
    if (logIndex !== -1) {
      readme.splice(logIndex, 2)
      await fs.promises.writeFile('README.md', readme.join('\n'))
    }
    try {
      for (const workflow of ['log', 'backup']) {
        await fs.promises.unlink(`./.github/workflows/${workflow}.yml`)
      }
    } catch /* eslint-disable no-empty */ {}
  }
  await fs.promises.writeFile('./packages/settings.json', settings)
  for (const file of ['README.md', 'package.json']) {
    await replaceOwnerRepository(file)
  }
  await promisify(exec)(
    `
  cd docs
  if ! [[ -d venv ]]; then
    pip3 install virtualenv
    virtualenv venv
  fi
  case "$(uname -s)" in
    MINGW* | MSYS*)
      . "./venv/Scripts/activate"
      ;;
    *)
      . "./venv/bin/activate"
      ;;
  esac
  pip3 install -r requirements.txt
  python overview.py
  `,
    { shell: '/bin/bash' }
  ).catch((error) => console.warn(`\u001B[91m${error}\u001B[0m`))
  for (const workflow of await fs.promises.readdir('./.github/workflows')) {
    await replaceOwnerRepository(`.github/workflows/${workflow}`)
  }
  console.log('✨ settings written ✨')
  await import('./generate-graphql-lambda-invoke-arns.mjs')

  const { githubSecrets } = await inquirer.prompt({
    type: 'confirm',
    message: 'Setup GitHub secrets',
    default: false,
    name: 'githubSecrets'
  })

  if (githubSecrets) {
    await updateGithubSecrets()
  }
} else {
  console.log('settings not written')
}

async function replaceOwnerRepository(file) {
  const data = await fs.promises.readFile(file, 'utf8')
  await fs.promises.writeFile(
    file,
    data
      .split(/[\n\r]/)
      .map((line) => {
        return line.startsWith('This project was bootstrapped with') ||
          line.includes('create repository from starterstack template') ||
          line.includes('install [prerequisites]')
          ? line
          : line
              .replaceAll(
                new RegExp(`${defaults.owner}/${defaults.repo}`, 'g'),
                `${owner}/${repo}`
              )
              .replaceAll(new RegExp(defaults.repo, 'g'), repo)
      })
      .join('\n')
  )
}

async function updateGithubSecrets() {
  const settings = JSON.parse(
    await fs.promises.readFile(
      new URL('../packages/settings.json', import.meta.url)
    )
  )

  const { actionsToken } = await inquirer.prompt({
    type: 'password',
    message:
      'Your GitHub PAT for actions (https://github.com/settings/tokens) with (repo:, write:packages, delete:packages)',
    name: 'actionsToken'
  })

  if (actionsToken) {
    const octokit = github.getOctokit(actionsToken)

    for (const { name, description, color } of [
      {
        name: 'dependencies',
        description: 'dependencies update',
        color: 'cfd3d7'
      },
      {
        name: 'feature deploy',
        description: 'deploy feature to own environment',
        color: '469435'
      },
      {
        name: 'environment deployed',
        description: 'topic branch environment deployed',
        color: 'faeddf'
      },
      {
        name: 'release:next',
        description: 'next release ready for production',
        color: '469435'
      }
    ]) {
      await Promise.all([
        octokit.rest.issues
          .createLabel({
            owner,
            repo,
            name,
            description,
            color
          })
          .catch(() => {}),
        octokit.rest.repos.update({
          owner,
          repo,
          allow_squash_merge: true,
          allow_merge_commit: false,
          allow_rebase_merge: false,
          allow_auto_merge: false,
          delete_branch_on_merge: true,
          allow_update_branch: true,
          squash_merge_commit_title: 'PR_TITLE',
          squash_merge_commit_message: 'BLANK'
        }),
        octokit.rest.actions.setGithubActionsDefaultWorkflowPermissionsRepository(
          {
            owner,
            repo,
            can_approve_pull_request_reviews: true,
            default_workflow_permissions: 'write'
          }
        ),

        octokit.rest.repos.updateBranchProtection({
          owner,
          repo,
          branch: 'main',
          required_status_checks: {
            strict: true,
            checks: []
          },
          required_pull_request_reviews: {
            dismiss_stale_reviews: false,
            require_code_owner_reviews: false,
            require_last_push_approval: false,
            required_approving_review_count: 1
          },
          enforce_admins: false,
          required_linear_history: true,
          allow_force_pushes: false,
          allow_deletions: false,
          block_creations: false,
          required_conversation_resolution: false,
          lock_branch: false,
          allow_fork_syncing: false,
          restrictions: undefined
        })
      ])
    }

    const { PAT_GITHUB: updatePAT } = await inquirer.prompt({
      type: 'confirm',
      message:
        'Update GitHub PAT for actions (https://github.com/settings/tokens) with (repo:, write:packages, delete:packages)',
      default: false,
      name: 'PAT_GITHUB'
    })

    if (updatePAT) {
      await updateRepoSecret({
        github: octokit,
        context: { repo: { owner, repo } },
        name: 'PAT_GITHUB',
        value: actionsToken
      })

      console.log('✨ PAT_GITHUB written ✨')
    }

    const stackSSMSecretsJson = await promptSecret({
      name: 'STACK_SSM_SECRETS_JSON',
      settings
    })
    if (stackSSMSecretsJson) {
      const { SLACK_OPS_URL: slackOpsUrl } = JSON.parse(stackSSMSecretsJson)
      await updateRepoSecret({
        github: octokit,
        context: { repo: { owner, repo } },
        name: 'STACK_SSM_SECRETS_JSON',
        value: stackSSMSecretsJson,
        dependabot: false
      })
      await updateRepoSecret({
        github: octokit,
        context: { repo: { owner, repo } },
        name: 'SLACK_OPS_URL',
        value: slackOpsUrl,
        dependabot: true
      })
    }

    let currentAccountStage

    try {
      const sts = new STSClient({ region: 'us-east-1' })
      const { Account: accountId } = await sts.send(
        new GetCallerIdentityCommand()
      )
      const stage = defaults.awsAccounts[accountId]?.stage
      if (stage && stage !== '*') {
        const { updateStage } = await inquirer.prompt({
          type: 'confirm',
          name: 'updateStage',
          message: `Update secrets for stage ${stage}`,
          default: true
        })
        if (updateStage) {
          currentAccountStage = stage
        }
      }
    } catch {}

    const { updateStage } = currentAccountStage
      ? { updateStage: currentAccountStage }
      : // eslint-disable-next-line unicorn/no-nested-ternary
        settings.accountPerStage
        ? await inquirer.prompt({
            type: 'list',
            message: 'Update secrets for stage',
            choices: ['all', ...stages],
            name: 'updateStage'
          })
        : { updateStage: 'dev' }

    for (const stage of (updateStage === 'all' ? stages : [updateStage]).map(
      (stage) => stage.toUpperCase()
    )) {
      for (const name of stage === 'LOG' && updateStage !== 'all'
        ? [
            `AWS_CI_READ_ONLY_ROLE_${stage}`,
            `AWS_CI_ROLE_${stage}`,
            'AWS_S3_LOG_BUCKET'
          ]
        : // eslint-disable-next-line unicorn/no-nested-ternary
          stage === 'BACKUP' && updateStage !== 'all'
          ? [
              `AWS_CI_READ_ONLY_ROLE_${stage}`,
              `AWS_CI_ROLE_${stage}`,
              'AWS_S3_BACKUP_BUCKET'
            ]
          : [
              `API_JWT_SECRET_${stage}`,
              `API_MFA_SECRET_${stage}`,
              `AWS_CI_READ_ONLY_ROLE_${stage}`,
              `AWS_CI_ROLE_${stage}`
            ]) {
        if (
          (stage === 'LOG' || stage === 'BACKUP') &&
          name.startsWith('API_')
        ) {
          continue
        }
        const value = await promptSecret({
          name: name.replace(/_(PROD)$/, '_$1UCTION'),
          settings
        })
        if (value) {
          for (const secretName of settings.accountPerStage
            ? [name.replace(/_(PROD)$/, '_$1UCTION')]
            : [
                name,
                name.replace(/_DEV$/, '_FEATURE'),
                name.replace(/_DEV$/, '_PRODUCTION')
              ]) {
            await updateRepoSecret({
              github: octokit,
              context: { repo: { owner, repo } },
              name: secretName,
              value,
              dependabot: false
            })
            console.log(`✨ ${secretName} written ✨`)
          }
        }
      }
    }
  }
}

async function randomSecret(size) {
  const bytes = await new Promise((resolve, reject) =>
    crypto.randomBytes(size, (err, buf) => (err ? reject(err) : resolve(buf)))
  )
  return bytes.toString('hex')
}

async function promptSecret({ name, settings }) {
  const { choice } = await inquirer.prompt({
    type: 'list',
    name: 'choice',
    message: name,
    choices:
      name.startsWith('AWS_CI_') ||
      name === 'AWS_S3_LOG_BUCKET' ||
      name === 'AWS_S3_BACKUP_BUCKET'
        ? ['skip', 'prompt', "use cloudformation's value"]
        : // eslint-disable-next-line unicorn/no-nested-ternary
          name === 'STACK_SSM_SECRETS_JSON'
          ? ['skip', 'prompt']
          : ['skip', 'prompt', 'generate random']
  })
  switch (choice) {
    case 'prompt': {
      if (name === 'STACK_SSM_SECRETS_JSON') {
        console.log(
          'in the format %s (as one line), slack, and sentry can be setup later',
          JSON.stringify({
            SLACK_OPS_URL: '',
            SLACK_ALARM_URL: '',
            SENTRY_DSN: ''
          })
        )
      }
      const { value } = await inquirer.prompt({
        type: 'input',
        message: `${name} [leave empty to skip]`,
        name: 'value'
      })
      return value
    }
    case 'generate random': {
      return await randomSecret(64)
    }
    case "use cloudformation's value": {
      try {
        const { stack, region, contains } = name.startsWith('AWS_CI_ROLE_')
          ? {
              stack: 'iam',
              contains: '-CiRole-',
              region: 'us-east-1'
            }
          : name.startsWith('AWS_CI_READ_ONLY_ROLE_')
            ? {
                stack: 'iam',
                contains: '-CiReadOnlyRole-',
                region: 'us-east-1'
              }
            : // eslint-disable-next-line unicorn/no-nested-ternary
              name === 'AWS_S3_LOG_BUCKET'
              ? {
                  stack: 'cloudtrail',
                  contains: '-S3cloudtraillogs-',
                  region: 'us-east-1'
                }
              : name === 'AWS_S3_BACKUP_BUCKET'
                ? {
                    stack: 'backup',
                    contains: '-S3backup-',
                    region: defaults.regions.backup
                  }
                : {}

        if (!stack) {
          throw new TypeError(`${name} not implemented`)
        }
        const { stdout = '', stderr } = await promisify(exec)(
          `aws cloudformation \
            describe-stacks \
              --stack-name ${settings.stackName}-${stack} \
              --region ${region} | \
                jq \
                  -r '.Stacks | .[] | .Outputs | .[] | select( .OutputValue | contains("-${stack}${contains}")) | .OutputValue'
          `,
          { shell: '/bin/bash' }
        )
        if (stderr) throw new Error(stderr)
        return stdout.trim()
      } catch (error) {
        console.warn(`\u001B[91m${error.toString()}\u001B[0m`)
      }

      break
    }
    // No default
  }
}
