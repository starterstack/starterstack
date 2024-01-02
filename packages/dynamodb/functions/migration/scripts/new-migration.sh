#!/usr/bin/env bash

set -euo pipefail

function new-migration() {
  local name
  read -r -p "Name? (^[a-z-]+$) " name
  if [[ -z "${name:-}" ]]; then
    echo -e "\x1B[91mmissing name\x1B[0m"
    exit 1
  fi
  if ! [[ "${name:?}" =~ ^[a-z-]+$ ]]; then
    echo -e "\x1B[91minvalid name ${name:?}, only lowercase characters, and - allowed\x1B[0m"
    exit 1
  fi
  local last
  local next
  local file
  last=$(
    cd migrations
    find \
      ./* \
      -type d |
      sed s'|^./||g' |
      sort -n -r |
      head -n 1
  )
  next=$((last + 1))
  mkdir -p migrations/${next:?}
  file=migrations/${next:?}/"${name:?}".js
  cat >"${file:?}" <<EOF
import dynamodb from '../../dynamodb.js'
import { DYNAMODB_STACK_TABLE } from '../table.js'

export async function migrate ({ log, abortSignal, onProcessed }) {
  onProcessed(0 /* count */)
}
EOF

  ${EDITOR:-vim} "${file:?}"

}

new-migration
