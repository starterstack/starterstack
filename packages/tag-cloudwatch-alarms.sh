#!/usr/bin/env bash

set -euo pipefail

function tag_cloudwatch_alarms() {
  local stack="${1:?}"
  local source="${BASH_SOURCE[0]}"
  local region="${2:?}"
  local stage="${3:?}"
  local aws_partition='aws'
  local alarm
  local account
  local arn_prefix
  local new_tags
  local current_tags

  account=$(
    aws sts get-caller-identity |
      jq -r '.Account'
  )

  local arn_prefix=arn:"${aws_partition}":cloudwatch:"${region:?}":"${account:?}":alarm:

  IFS=$'\n'

  for alarm in $(
    aws cloudformation list-stack-resources \
      --stack-name "${stack:?}" \
      --region "${region:?}" \
      --query """
          StackResourceSummaries[?ResourceType=='AWS::CloudWatch::Alarm'].{PhysicalResourceId: PhysicalResourceId}
      """ \
      --output text
  ); do

    new_tags="$(
      node -p """
      JSON.stringify({
        ManagedBy: require('$(dirname "${source:?}")/../packages/settings.json').stackName,
        Name: \"${alarm:?}\"
        .replace(/>=/g, '-gte')
        .replace(/>/g, '-gt')
        .replace(/[^_.:\/=\+\-@a-z0-9\s]/gi, ' ').slice(0, 128),
        STAGE: \"${stage:?}\"
      })
    """ |
        jq -r '''
          to_entries |
          map (
            .Key=.key |
            .Value=.value |
            del(.key,.value)
          )
        '''
    )"

    current_tags=$(
      aws cloudwatch \
        list-tags-for-resource \
        --resource-arn "${arn_prefix:?}${alarm:?}" \
        --region "${region:?}" |
        jq -r '.Tags'
    )

    # to avoid throttling check tags match
    if [[ -n "${current_tags:-}" ]]; then
      if node -e """
        const assert = require('node:assert')
        const tags = process.argv.slice(1).map(tags => {
          const json = JSON.parse(tags)
          return json.sort((a, b) => {
            if (a.Key > b.Key) return 1
            if (a.Key < b.Key) return -1
            return 0
          })
          return json
        })
        try {
          assert.deepStrictEqual(tags[0], tags[1])
          process.exit(0)
        } catch {
          process.exit(1)
        }
      """ "${new_tags:?}" "${current_tags:?}"; then
        continue
      fi
    fi

    aws cloudwatch \
      tag-resource \
      --resource-arn "${arn_prefix:?}${alarm:?}" \
      --tags "${new_tags:?}" \
      --region "${region:?}"
  done

}

if [[ -n "${1:-}" ]] &&
  [[ -n "${2:-}" ]] &&
  [[ -n "${3:-}" ]]; then
  tag_cloudwatch_alarms "${1:?}" "${2:?}" "${3:?}"
fi
