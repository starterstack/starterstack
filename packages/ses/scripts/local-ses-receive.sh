#!/usr/bin/env bash

set -euo pipefail

log_error() { echo -e "\033[0m\033[1;91m${*}\033[0m"; }
log_info() { echo -e "\033[0m\033[1;94m${*}\033[0m"; }

function invoke() {
  local stack_name
  local source="${BASH_SOURCE[0]}"
  declare -r directory=$(dirname "${source:?}")
  if ! command -v swaks &>/dev/null; then
    log_error "swaks missing\ninstall guide is https://jetmore.org/john/code/swaks/installation.html"
    exit 1
  fi

  swaks \
    --to hello@localhost \
    --from test@localhost \
    --attach @../../README.md \
    --attach @../../package.json \
    --attach @../../LICENSE \
    --header "Subject: local files" \
    --dump-mail >email.eml

  stack_name="$(node -p "require('${directory:?}/../../settings')().stackName")"
  export STACK_NAME="${stack_name:?}"
  export IS_OFFLINE=1

  (
    cd "${directory:?}/.."
    node scripts/local-ses-receive-invoke.mjs
  )
}

invoke
