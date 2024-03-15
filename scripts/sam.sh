#!/usr/bin/env bash

set -euo pipefail

function sam() {
  local source="${BASH_SOURCE[0]}"
  local stage="${1:?}"
  local region="${2:?}"
  local package_lock
  local remove
  local lint_only
  local deploy

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

  if [[ "${5:?}" == "true" ]]; then
    lint_only=1
  else
    lint_only=0
  fi

  if [[ ${package_lock:?} -eq 1 ]]; then
    npm install \
      --no-save \
      --audit false \
      --fund false \
      --ignore-scripts
  fi

  if [[ ${remove:?} -eq 1 && ${lint_only:?} -eq 0 ]]; then
    STAGE="${stage:?}" node \
      "$(dirname "${source:?}")/../node_modules/.bin/sam-expand" \
      delete \
      --region "${region:?}" \
      --no-prompts
  else
    node \
      "$(dirname "${source:?}")/../node_modules/.bin/sam-expand" \
      build \
      -p \
      --no-cached \
      --parameter-overrides Stage="${stage:?}" \
      --region "${region:?}"

    STAGE="${stage:?}" node \
      "$(dirname "${source:?}")/../node_modules/.bin/sam-expand" \
      validate \
      --lint \
      -t .aws-sam/build/template.yaml \
      --region "${region:?}"

    if [[ ${lint_only?} -eq 0 ]]; then
      if [[ "${stage:?}" =~ "^pr-" ]]; then
        deploy="sync"
      else
        deploy="deploy"
      fi
      node \
        "$(dirname "${source:?}")/../node_modules/.bin/sam-expand" \
        ${deploy:?} \
        --parameter-overrides Stage="${stage:?}" \
        --region "${region:?}"
    fi
  fi

}

sam \
  "${1:?'missing stage'}" \
  "${2:?'missing region'}" \
  "${3:?'missing package lock'}" \
  "${4:?'missing remove'}" \
  "${5:-false}"
