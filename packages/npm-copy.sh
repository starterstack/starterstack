#!/usr/bin/env bash

set -euo pipefail

declare -r me=$(basename "$0")

rm -rf node_modules

if [[ -n ${SHARP_IGNORE_GLOBAL_LIBVIPS:-} ]]; then
  SHARP_IGNORE_GLOBAL_LIBVIPS=1 \
    npm install \
    --os=linux \
    --cpu=arm64 \
    --no-save \
    --audit false \
    --fund false \
    --loglevel=error \
    --omit=dev
else
  npm install \
    --no-save \
    --audit false \
    --fund false \
    --loglevel=error \
    --ignore-scripts \
    --omit=dev
fi

cp -r . ${ARTIFACTS_DIR:?}

cd ${ARTIFACTS_DIR:?}

git init &>/dev/null
git config init.defaultBranch main
git config user.email "user@example.com"
git config user.name "${me:?}"
echo """
.DS_Store
.aws-sam
.nycrc
.husky
.envrc
coverage
docs
examples
.build_hash
package-lock.json
node_modules/jest
node_modules/typescript
node_modules/@types
node_modules/@aws-sdk/**/dist-es
node_modules/@aws-sdk/*-browser
node_modules/@aws-sdk/**/dist-types
node_modules/@aws-crypto/**/*.html
node_modules/@aws-crypto/ie11-detection
node_modules/@aws-crypto/sha256-browser
node_modules/@aws-crypto/supports-web-crypto
node_modules/otpauth/src
node_modules/otpauth/types
node_modules/otpauth/dist/*.min.js
node_modules/otpauth/dist/otpauth.esm*
node_modules/otpauth/dist/otpauth.umd*
node_modules/jssha
node_modules/tslib/**/*.html
node_modules/@graphql-tools/**/cjs
node_modules/graphql/**/*.mjs
node_modules/web-streams-polyfill
.bin
bin
.history
test
tests
__tests__
tap-snapshots
*.bnf
*.png
*.svg
*.jpg
*.jpeg
*.gif
*.webp
*.webm
*.mp4
*.mp3
*.mov
*.asf
*.ts
*.mts
*.cts
*.mjs.map
*.cjs.map
*.js.map
*.ts.map
*.mts.map
*.cts.map
*.flow
*.coffee
*.coffee.map
*.gypi
*.jst
*.sln
*.swp
*.obj
*.txt
*.d.*
*.vcxproj.filters
*.vcxproj
tsconfig.json
tsconfig.*.json
.gitattributes
.editorconfig
.eslintignore
.eslintrc
.eslintrc*
.prettier*
webpack.config.*
README
readme
README.*
readme.*
HISTORY.md
CHANGELOG.md
SECURITY.md
package-lock.json
yarn.lock
LICENSE
LICENSE*
license*
.npmignore
.npmrc
.travis.yml
.github
appveyor.yml
circle.yml
AUTHORS*
CONTRIBUTORS*
CONTRIBUTING.*
CODE_OF_CONDUCT.*
benchmark
bower.json
builderror.log
cakefile
changes
circle.yml
desktop.ini
Dockerfile
eslint
Gruntfile.js
Gulpfile.js
jest.config.js
jsl.conf
karma.conf.js
Makefile
mocha.opts
stylelint.config.js
tsdoc-metadata.json
node_modules/@pdf-lib/standard-fonts/dist
node_modules/@pdf-lib/standard-fonts/es
node_modules/@pdf-lib/upng/dist
node_modules/@pdf-lib/upng/UPNG.js
node_modules/@faker-js/faker/dist/cjs
node_modules/@faker-js/faker/locale
node_modules/pako/dist
node_modules/pdf-lib/es
node_modules/pdf-lib/dist
node_modules/pdf-lib/src
.gitignore
!.include-lambda-blob-files/*
${me:?}
""" >.gitignore
git add -f .gitignore &>/dev/null
git commit -m ".gitignore" &>/dev/null
git add . &>/dev/null
git commit -m "files" &>/dev/null
git clean -dfXq
rm -rf .git
