#!/usr/bin/env bash

set -euo pipefail

(
  cd packages/shared
  npm t
)
