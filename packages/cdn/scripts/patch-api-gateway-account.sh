#!/usr/bin/env bash

set -euo pipefail

function update_account() {
  local region="${1:?}"
  local role="${2:?}"

  aws \
    apigateway \
    update-account \
    --region "${region:?}" \
    --patch-operations \
    op='replace',path='/cloudwatchRoleArn',value="${role:?}"
}

if [[ -n "${1:-}" ]] &&
  [[ -n "${2:-}" ]]; then
  update_account "${1:?}" "${2:?}"
fi
