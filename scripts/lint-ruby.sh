#!/usr/bin/env bash

set -ueo pipefail

if command -v rbprettier &>/dev/null; then
  rbprettier --write "${@}"
fi
