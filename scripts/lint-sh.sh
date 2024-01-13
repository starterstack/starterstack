#!/usr/bin/env bash

set -ueo pipefail

if ! docker stats --no-stream &>/dev/null; then
  if command -v shfmt &>/dev/null; then
    shfmt -l -i 2 -w "${@}"
    exit 0
  else
    exit 0
  fi
fi

#shellcheck disable=SC2001
files=$(echo "$*" | sed "s;$(pwd);/work;g")

if [[ -n "${files:-}" ]]; then
  docker run \
    --rm \
    -i \
    -v "$(pwd)":/work \
    -w /work \
    mvdan/shfmt:v3.4.2-alpine \
    sh -c "shfmt -l -i 2 -w ${files:?}"
fi
