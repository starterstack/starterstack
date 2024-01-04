#!/usr/bin/env bash

set -euo pipefail

function deploy() {
  local source="${BASH_SOURCE[0]}"
  local stage="${1:?}"
  local region="${2:?}"
  local package_lock
  local remove

  if [[ "${3:?}" == "true" ]]; then
    package_lock=1
  else
    package_lock=0
  fi

  if [[ "${4:?}" == "true" ]]; then
    remove=1
  else
    remove=0
  fi

  if [[ ${package_lock:?} -eq 1 ]]; then
    npm install \
      --no-save \
      --audit false \
      --fund false \
      --ignore-scripts
  fi

  if [[ ${remove:?} -eq 1 ]]; then
    STAGE="${stage:?}" node \
      "$(dirname "${source:?}")/../node_modules/.bin/sam-expand" \
      delete \
      --region "${region:?}" \
      --no-prompts
  else
    node \
      "$(dirname "${source:?}")/../node_modules/.bin/sam-expand" \
      build \
      --parameter-overrides Stage="${stage:?}" \
      --region "${region:?}"

    STAGE="${stage:?}" node \
      "$(dirname "${source:?}")/../node_modules/.bin/sam-expand" \
      validate \
      --lint \
      -t .aws-sam/build/template.yaml \
      --region "${region:?}"

    node \
      "$(dirname "${source:?}")/../node_modules/.bin/sam-expand" \
      deploy \
      --parameter-overrides Stage="${stage:?}" \
      --region "${region:?}"
  fi

}

deploy \
  "${1:?'missing stage'}" \
  "${2:?'missing region'}" \
  "${3:?'missing package lock'}" \
  "${4:?'missing remove'}"
