#!/usr/bin/env bash

set -euo pipefail

function deploy() {
  declare -r op="${1:?}"
  local region
  local regionDirectory
  local pid
  local account

  account=$(
    aws sts get-caller-identity |
      jq -r '.Account'
  )

  declare -r regions=$(node -p """
  const settings = require('../settings.json')
  const accountId = '${account:?}'
  const regions = settings.accountPerStage
  ? [settings.regions[settings.awsAccounts[accountId].stage]]
  : Object.values(settings.regions)
  ;
  [
    ...new Set([
        'us-east-1',
        'eu-west-1',
        ...regions
    ])
  ].join(' ')
  """)

  cleanup
  for region in ${regions:?}; do
    regionDirectory="../monitoring-${region:?}"
    rm -rf "${regionDirectory:?}"
    mkdir -p "${regionDirectory:?}"
    cp -r ./* "${regionDirectory:?}"
    (
      cd "${regionDirectory:?}"
      npx sls "${op:?}" \
        -c monitoring.yml \
        --region "${region:?}"
    ) &
  done
  for pid in $(jobs -p); do
    if ! wait "${pid:?}"; then
      exit 1
    fi
  done
}

function cleanup() {
  rm -rf ../monitoring-*
}

trap cleanup EXIT

deploy "${1:?'missing package/deploy'}"
