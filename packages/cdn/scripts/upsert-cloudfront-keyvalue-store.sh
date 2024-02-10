#!/usr/bin/env bash

set -euo pipefail

function refresh_secret() {
  local stack="${1:?}"
  local region="${2:?}"

  declare -r lambda=$(
    aws cloudformation describe-stacks \
      --stack-name "${stack:?}" \
      --region "${region:?}" |
      jq \
        -r '.Stacks | .[] | .Outputs | .[] | select( .OutputKey == "ApiJwtSecretChangedFunction") | .OutputValue'
  )

  declare -r output=$(aws lambda invoke \
    --region "${region:?}" \
    --function-name "${lambda:?}" \
    --cli-binary-format raw-in-base64-out \
    --payload '{"refreshSecretOnly": true}' \
    --log-type 'None' \
    --invocation-type 'RequestResponse' \
    /dev/null)

  echo "${output}" | jq -r '{ "statusCode": .StatusCode }'

  if ! echo "${output}" | grep -q '"StatusCode": 200'; then
    echo failed run invoke lambda, bad status code
    exit 1
  fi
}

if [[ -n "${1:-}" ]] &&
  [[ -n "${2:-}" ]]; then
  refresh_secret "${1:?}" "${2:?}"
fi
