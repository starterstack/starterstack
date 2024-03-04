#!/usr/bin/env bash

set -euo pipefail

function update_account() {
  local region="${1:?}"
  local stage_region="${2:?}"
  local role="${3:?}"

  if [[ "${region:?}" == "${stage_region:?}" ]]; then
    aws \
      apigateway \
      update-account \
      --region "${region:?}" \
      --patch-operations \
      op='replace',path='/cloudwatchRoleArn',value="${role:?}"
  fi

}

if [[ -n "${1:-}" ]] &&
  [[ -n "${2:-}" ]] &&
  [[ -n "${3:-}" ]]; then
  update_account "${1:?}" "${2:?}" "${3:?}"
fi
