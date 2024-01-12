#!/usr/bin/env bash

set -ueo pipefail

log_error() { echo -e "\033[0m\033[1;91m${*}\033[0m"; }

npm install \
  --no-save \
  --audit false \
  --fund false \
  --loglevel=error \
  --ignore-scripts \
  --prefix ./.github/actions

rm -rf ./.github/actions/dist
mkdir -p ./.github/actions/dist

function build() {
  local file
  file="$(basename "${1:?}")"
  local out
  (
    cd .github/actions
    npx \
      --no-install \
      esbuild \
      --bundle \
      --minify \
      --target=node20 \
      --banner:js="""import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)""" \
      --format=esm "${file:?}" \
      --platform=node >dist/"${file:?}"
  )
}

while IFS= read -r file; do
  build "${file:?}" &
done < <(find ./.github/actions -maxdepth 1 -type f -name "*.js")

for pid in $(jobs -p); do
  if ! wait "${pid:?}"; then
    exit 1
  fi
done

ln -s ../../../packages/settings.json .github/actions/dist/settings.json

if ! git diff -s --exit-code ./.github/actions/dist; then
  log_error "please add .github/actions/dist as changes detected"
  git add ./.github/actions/dist
fi
