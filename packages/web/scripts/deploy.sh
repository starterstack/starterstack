#!/usr/bin/env bash

set -euo pipefail

function deploy() {
  local s3_bucket="${1:?'missing s3 bucket'}"
  local distribution_id="${2:?'missing distribution id'}"
  local region="${3:?'missing region'}"
  aws s3 cp build s3://"${s3_bucket:?}" \
    --recursive \
    --exclude "*/**/*" \
    --exclude "index.html" \
    --exclude "asset-manifest.json" \
    --exclude "service-worker.js*" \
    --endpoint-url https://s3-accelerate.amazonaws.com \
    --cache-control 'must-revalidate, public, max-age=3600' \
    --storage-class 'INTELLIGENT_TIERING'
  aws s3 cp build/static s3://"${s3_bucket:?}"/static \
    --recursive \
    --exclude "js/ssr*" \
    --endpoint-url https://s3-accelerate.amazonaws.com \
    --cache-control 'must-revalidate, public, max-age=31536000' \
    --storage-class 'INTELLIGENT_TIERING'
  aws s3 cp build/service-worker.js s3://"${s3_bucket:?}" \
    --endpoint-url https://s3-accelerate.amazonaws.com \
    --cache-control 'no-cache' \
    --storage-class 'INTELLIGENT_TIERING'
  if [[ "${distribution_id:?}" != "none" ]]; then
    aws cloudfront create-invalidation \
      --region "${region:?}" \
      --distribution-id "${distribution_id:?}" \
      --paths "/static/*" "/manifest.json" "/favicon.ico" "/logo192.png" "/logo512.png"
  fi
}

deploy "${1:-}" "${2:-}" "${3:-}"
