#!/usr/bin/env bash

set -euo pipefail

function delete_lambda_log_group() {
  local stack="${1:?}"
  local source="${BASH_SOURCE[0]}"
  local region="${2:?}"

  account=$(
    aws sts get-caller-identity |
      jq -r '.Account'
  )

  # try and delete ignore all errors (might be ResourceNotFoundException)
  aws logs delete-log-group \
    --log-group-name "/aws/lambda/${stack:?}" \
    --region "${region:?}" || true
}

if [[ -n "${1:-}" ]] &&
  [[ -n "${2:-}" ]]; then
  delete_lambda_log_group "${1:?}" "${2:?}"
fi
