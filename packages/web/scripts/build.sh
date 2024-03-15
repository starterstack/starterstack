#!/usr/bin/env bash

set -euo pipefail

function build() {
  local build_hash
  build_hash="$(node ../../scripts/directory-hash.mjs '.' '' '..')"
  if [[ -d build ]] &&
    [[ -f .ssr_build_hash ]] &&
    [[ "$(tr -d '\r\n' <.ssr_build_hash)" =~ ^${build_hash:?}$ ]]; then
    touch .built
    return
  fi

  rm -rf build
  rm -rf .built

  INLINE_RUNTIME_CHUNK=false \
    STACK_REGION="${1:?}" \
    REACT_APP_SENTRY_DSN="${2:-}" \
    REACT_APP_SENTRY_ENVIRONMENT="${3:-}" \
    REACT_APP_GIT_COMMIT="${4:-}" \
    REACT_APP_STAGE="${5:-}" \
    npx react-app-rewired build
  echo "${build_hash:?}" >.ssr_build_hash
  touch .built
}

build \
  "${1:?'missing stack region'}" \
  "${2:-}" \
  "${3:-}" \
  "${4:-}" \
  "${5:-}"
