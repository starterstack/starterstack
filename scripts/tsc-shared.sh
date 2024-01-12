#!/usr/bin/env bash

set -ueo pipefail

for file in "$@"; do
  if grep -q "@ts-check" "${file:?}"; then
    ./node_modules/.bin/tsc "${file:?}" \
      --target es2022 \
      --moduleResolution node16 \
      --module node16 \
      --allowJs \
      --noEmit \
      --esModuleInterop \
      --skipLibCheck \
      --checkJs \
      --strict &
  fi
done

for pid in $(jobs -p); do
  if ! wait "${pid:?}"; then
    exit 1
  fi
done
