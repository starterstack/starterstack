#!/usr/bin/env bash

set -euo pipefail

function ssm() {
  local remove="${1:-}"
  local name="${2:?'missing name'}"
  local value="${3:-}"
  local region="${4:?'missing region'}"
  local current_value
  local tags
  if [[ -z "${value:-}" ]]; then
    echo "skipping, missing value for ${name:?} in region ${region:?}"
    return
  fi

  if [[ "${remove:-}" == "true" ]]; then
    aws \
      ssm \
      delete-parameter \
      --region "${region:?}" \
      --name "${name:?}" || true
    return
  fi
  current_value=$(
    aws \
      ssm \
      get-parameter \
      --region "${region:?}" \
      --name "${name:?}" \
      --with-decryption | jq -r '.Parameter.Value'
  ) || true

  if [[ "${current_value:-}" != "${value:?}" ]]; then
    echo "updating ${name:?} in region ${region:?}"
    aws \
      ssm \
      put-parameter \
      --region "${region:?}" \
      --name "${name:?}" \
      --description "${name:?}" \
      --value "${value:?}" \
      --type SecureString \
      --overwrite \
      --tier Intelligent-Tiering \
      --data-type text
    tags="$(
      node -p """
      JSON.stringify({
        ...(require('./packages/settings.js')().defaultTags),
        Name: \"${name:?}\"
      })
    """ |
        jq -r '''
        to_entries | map (.Key=.key | .Value=.value | del(.key,.value))
      '''
    )"

    aws \
      ssm \
      add-tags-to-resource \
      --region "${region:?}" \
      --resource-type "Parameter" \
      --resource-id "${name:?}" \
      --tags "${tags:?}"

    echo "result=changed" >>"${GITHUB_OUTPUT:?}"
  fi
}

function ssm-json() {
  declare -r remove="${1:-}"
  declare -r stack="${2:?}"
  declare -r stage="${3:?}"
  declare -r region="${4:?}"
  declare -r json="${5:?}"

  local name
  local ssm_name
  local value
  echo "${json:?}" |
    jq -rs '.[0] * .[1] | to_entries | .[] | [.key, .value] | @tsv' |
    while IFS=$'\t' read -r name value; do
      ssm_name="/${stack:?}/${stage:?}/${name:?}"
      ssm "${remove:-}" "${ssm_name:?}" "${value:-}" "${region:?}" &
      if [[ "${region:?}" != "us-east-1" ]]; then
        ssm "${remove:-}" "${ssm_name:?}" "${value:-}" "us-east-1" &
      fi
      if [[ "${remove:-}" != "true" ]]; then
        ssm_name="/${stack:?}/global/${name:?}"
        ssm "${remove:-}" "${ssm_name:?}" "${value:-}" "${region:?}" &
        if [[ "${region:?}" != "us-east-1" ]]; then
          ssm "${remove:-}" "${ssm_name:?}" "${value:-}" "us-east-1" &
        fi
      fi
    done
}

ssm-json \
  "${1:-}" \
  "${2:?'missing stack'}" \
  "${3:?'missing stage'}" \
  "${4:?'missing region'}" \
  "${5:?'missing json'}"

for pid in $(jobs -p); do
  if ! wait "${pid:?}"; then
    exit 1
  fi
done
