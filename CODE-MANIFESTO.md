# ⚡ Code Manifesto ⚡

## Tests, Linting, Git commits

- Don't use `--no-verify`

## Node

- Use the configured node version specified in [.envrc](./.envrc)

## Filenames

- Lowercase [Kebab case](https://en.wikipedia.org/wiki/Letter_case#Kebab_case) only (Unless third party tools enforce otherwise
- Linting is configured in the `lint-staged` section of [package.json](./package.json)

## JavaScript

- Use [ECMAScript modules](https://nodejs.org/api/esm.html)

## Lambda functions

- Derive handlers from [lambda-handler.js](./packages/shared/lambda-handler.js)
- Errors thrown (unhandled or not) should be logged included the event
- `correlationIds` used when persisting data or firing new events
- `abortSignal` used for all async operations
- `log` used instead of `console.log`
- Permissions should be minimal on a per function basis
- Use `X-Ray` for all AWS-SDK clients, and all http calls
- Use [shared aws clients](./packages/shared)
- Appropriate memory size (profile from 128MB first)
- Add DynamoDB leading keys as IAM condition when possible
- Try hard to keep size under 3MB

## DynamoDB

- No scan
- Pagination should not read everything in a loop
- Check for too many changes for CloudFormation to handle in single update

## S3

- Use storage class `Intelligent-Tiering` for objects kept longer than 30 days
- Tag all documents
- Include metadata encoded as rfc2047 by [s3.js](./packages/shared/s3.js)

## Shared code in `./packages/shared`

- Use `@ts-check` and [typedoc](https://typedoc.org/) in `.js` files

## CloudFormation stacks

- `template.yaml`

  X-Ray config in `Globals:` block of `template.yaml` if there are lambda functions

  ```yaml
  Globals:
    Function:
      Tracing: Active
  ```

- plugins [generate-cloudwatch-alarms.mjs](./packages/generate-cloudwatch-alarms.mjs), [default-tags.mjs](./packages/default-tags.mjs) included
- [tag-cloudwatch-alarms.sh](./scripts/tag-cloudwatch-alarms.sh) used in `after:deploy:deploy` hook
- [tag-eventbus-rules.sh](./scripts/tag-eventbus-rules.sh) used in `after:deploy:deploy` hook if there are event bus rules
- all async functions to have `DLQ` configured with destination on failure with a retry policy
- all sns events to have `DLQ` configured with a redrive policy
- `GIT_COMMIT` added as environment variable to all lambda functions
- check for untagged resources in aws console

  `resource-groups/tag-editor/find-resources` in stack region

  Resource types: "All supported resources types"

  Tags: "ManagedBy: (not-tagged)"

## Shell scripts

- `set -euo pipefail` # error on error, pipe failure, and unbound variables
- name script with `.sh` suffix
- chmod +x
- use [shellcheck](https://github.com/koalaman/shellcheck)

## GitHub Actions

- Use `actions/github-script` to use custom js scripts
- Review any third party actions, especially when steps have AWS access
- [Reuse workflows](https://docs.github.com/en/actions/using-workflows/reusing-workflowss://docs.github.com/en/actions/using-workflows/reusing-workflows)
- Report to slack with [slack.yml](./.github/workflows/slack.yml)
- Add any stack that has to be deployed first (depended on by others) in [sls-env.yml](./.github/workflows/sls-env.yml)

## Unit tests

- Use [Node core test runner](https://nodejs.org/docs/latest-v20.x/api/test.html) for unit tests
