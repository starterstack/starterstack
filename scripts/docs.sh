#!/usr/bin/env bash

set -euo pipefail

log_error() { echo -e "\033[0m\033[1;91m${*}\033[0m"; }
log_info() { echo -e "\033[0m\033[1;94m${*}\033[0m"; }

function browse() {
  declare docs_url="http://localhost:8080/workspace/diagrams#starterstack"
  log_info "will open browser at ${docs_url:?} when docs are available"
  while true; do
    if curl --fail \
      "${docs_url:?}" &>/dev/null; then
      break
    fi
    sleep 2
  done
  if command -v xdg-open &>/dev/null; then
    xdg-open "${docs_url:?}"
  elif command -v explorer &>/dev/null; then
    explorer "${docs_url:?}"
  else
    open "${docs_url:?}"
  fi
}

function docs() {
  declare -r structurizr_version="2024.01.02"
  declare -r structurizr=".structurizr-${structurizr_version:?}.war"
  if command -v java &>/dev/null; then
    if [[ ! -f "${structurizr:?}" ]]; then
      log_info "downloading structurizr ${structurizr_version:?}"
      curl \
        --fail \
        -L \
        -o "/tmp/${structurizr:?}" \
        https://github.com/structurizr/lite/releases/download/${structurizr_version:?}/structurizr-lite.war
      mv /tmp/"${structurizr:?}" "${structurizr:?}"
    fi
    browse &
    java \
      -Djdk.util.jar.enableMultiRelease=false \
      -Dserver.port=8080 \
      -jar "${structurizr:?}" \
      docs/structurizr
  else
    if ! docker stats --no-stream &>/dev/null; then
      log_error "You need docker or java to run structurizr"
      exit 1
    fi
    browse &
    docker \
      run \
      -it \
      --rm \
      -p 8080:8080 \
      -v "$(pwd)"/docs/structurizr:/usr/local/structurizr \
      structurizr/lite:${structurizr_version:?}
  fi
}

docs
