#!/usr/bin/env bash

set -euo pipefail

function patch_files() {
  local file
  while IFS= read -r file; do
    if ! patch \
      --no-backup-if-mismatch \
      -f \
      -p0 <"${file:?}" \
      &>/dev/null; then
      # already patched
      continue
    fi
  done < <(find ./scripts -type f -name "*.patch")
}

patch_files
