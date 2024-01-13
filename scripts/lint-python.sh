#!/usr/bin/env bash

set -ueo pipefail

if ! docker stats --no-stream &>/dev/null; then
  if command -v black &>/dev/null; then
    black "${@}"
    exit 0
  else
    exit 0
  fi
fi

#shellcheck disable=SC2001
files=$(echo "$*" | sed "s;$(pwd);/data;g")

if [[ -n "${files:-}" ]]; then
  docker run \
    --rm \
    -i \
    -v "$(pwd)":/data \
    -w /data \
    cytopia/black \
    "${files:?}"
fi
