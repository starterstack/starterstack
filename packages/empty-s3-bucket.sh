#!/usr/bin/env bash

set -euo pipefail

function empty_s3_bucket() {
  local s3_bucket="${1:?}"
  local s3_prefix="${2:-}"
  aws s3 \
    rm \
    "s3://${s3_bucket:?}/${s3_prefix:-}" \
    --recursive
  empty_marked_for_deletion "${s3_bucket:?}" "${s3_prefix:-}"
}

function empty_marked_for_deletion {
  local s3_bucket="${1:?}"
  local delete_file="${1:?}"_delete.json
  local versions_delete_file="${1:?}"_versions_delete.json
  local prefix="${2:-}"
  local type
  aws s3api \
    list-object-versions \
    --bucket "${s3_bucket:?}" \
    --prefix "${prefix:-}" \
    >"${delete_file:?}"
  for type in DeleteMarkers Versions; do
    cat "${delete_file:?}" |
      jq -r """
      {
        Objects: [.${type}[]? |
        {
          Key: .Key,
          VersionId: .VersionId
        }],
        Quiet: true
      }
      """ >"${versions_delete_file:?}"
    if grep -q '"Objects":' "${versions_delete_file:?}" &&
      ! grep -q '"Objects": \[\]' "${versions_delete_file:?}"; then
      aws s3api \
        delete-objects \
        --bucket "${s3_bucket:?}" \
        --delete file://"${versions_delete_file:?}"
    fi
    rm -rf "${versions_delete_file:?}"
  done
  rm -rf "${delete_file:?}"
}

if [[ -n "${1:-}" ]]; then
  empty_s3_bucket "${1:?}" "${2:-}"
fi
