import test from 'node:test'
import assert from 'node:assert'
import vm from 'node:vm'
import path from 'node:path/posix'
import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'
import getFunctionCode from '../../cloudfront-functions.mjs'

const apiSecrets = {
  latest: 'latest',
  1: '1',
  2: '2',
  3: '3',
  4: '4'
}

const anonymousTokenParts = [
  '{"alg":"HS256","typ":"JWT"}',
  `{"v": "${apiSecrets.latest}", "iat": ${Date.now() / 1000}}`
]
  .map((value) => Buffer.from(value).toString('base64url'))
  .join('.')

const anonymousSignature = crypto
  .createHmac('sha256', `cf:${apiSecrets[apiSecrets.latest]}`)
  .update(anonymousTokenParts)
  .digest('base64url')

const anonymousTokenString = anonymousTokenParts + '.' + anonymousSignature

delete apiSecrets.latest

const keyValueStore = {
  config: {
    apiSecrets,
    anonymousTokenString
  }
}

await test('viewer request', async (t) => {
  await t.test('forbidden', async (t) => {
    for (const stage of ['dev', 'pr-x', 'prod']) {
      await t.test(stage, async () => {
        for (const event of [
          {
            request: {
              uri: '/',
              headers: {}
            }
          },
          {
            request: {
              uri: '/',
              headers: {
                host: {
                  value: 'x'
                }
              }
            }
          }
        ]) {
          assert.deepEqual(
            await viewerRequest(await cloudfrontFunctionsForStage(stage))(
              event
            ),
            {
              statusCode: 403,
              statusDescription: 'Forbidden'
            }
          )
        }
      })
    }
  })

  await t.test('origin unknown', async (t) => {
    for (const stage of ['dev', 'pr-x', 'prod']) {
      for (const origin of ['', 'about:client', 'null']) {
        await t.test(`${stage} with origin ${origin}`, async () => {
          const { stageRoot } = settings(stage)
          const event = {
            request: {
              uri: '/',
              querystring: {},
              cookies: {},
              headers: {
                host: {
                  value: stageRoot
                },
                origin: {
                  value: origin
                }
              }
            }
          }

          const request = await viewerRequest(
            await cloudfrontFunctionsForStage(stage)
          )(event)

          assert.strict.ok(request.statusCode !== 403)
        })
      }
    }
  })

  await t.test('referer unknown', async (t) => {
    for (const stage of ['dev', 'pr-x', 'prod']) {
      for (const referer of [
        '',
        'null',
        'android-app://com.google.android.gm/'
      ]) {
        await t.test(`${stage} with referer ${referer}`, async () => {
          const { stageRoot } = settings(stage)

          const event = {
            request: {
              uri: '/',
              querystring: {},
              cookies: {},
              method: 'GET',
              headers: {
                host: {
                  value: stageRoot
                },
                referer: {
                  value: referer
                }
              }
            }
          }

          const request = await viewerRequest(
            await cloudfrontFunctionsForStage(stage)
          )(event)

          assert.strict.ok(request.statusCode !== 403)
        })
      }
    }
  })

  await t.test('origin mismatch', async (t) => {
    for (const stage of ['dev', 'pr-x', 'prod']) {
      await t.test(`${stage} origin mismatch`, async () => {
        const { stageRoot } = settings(stage)

        for (const event of [
          {
            request: {
              uri: '/',
              querystring: {},
              cookies: {},
              headers: {
                host: {
                  value: stageRoot
                },
                origin: {
                  value: 'x'
                }
              }
            }
          },
          {
            request: {
              uri: '/',
              headers: {
                host: {
                  value: stageRoot
                },
                referer: {
                  value: 'https://example.com/'
                }
              }
            }
          }
        ]) {
          const request = await viewerRequest(
            await cloudfrontFunctionsForStage(stage)
          )(event)
          assert.deepEqual(request, {
            statusCode: 403,
            statusDescription: 'Forbidden'
          })
        }
      })
    }
  })

  await t.test('path rewrites', async (t) => {
    await t.test('/api/ws', async (t) => {
      for (const stage of ['dev', 'pr-x', 'prod']) {
        await t.test(stage, async () => {
          const { stageRoot } = settings(stage)
          for (const event of [
            {
              request: {
                uri: '/api/ws',
                querystring: {},
                cookies: {},
                headers: {
                  host: {
                    value: stageRoot
                  }
                }
              }
            },
            {
              request: {
                uri: '/api/ws/graphql',
                querystring: {},
                cookies: {},
                headers: {
                  host: {
                    value: stageRoot
                  }
                }
              }
            }
          ]) {
            const uri = event.request.uri
            const request = await viewerRequest(
              await cloudfrontFunctionsForStage(stage)
            )(event)

            assert.strict.ok(request.headers['x-now'].value)
            delete request.headers['x-now']

            assert.strict.ok(request.cookies.token.value)
            delete request.cookies.token

            assert.deepEqual(request, {
              uri: `/${stage}`,
              cookies: {},
              querystring: {},
              headers: {
                ...event.request.headers,
                ['x-url']: {
                  value: uri
                }
              }
            })
          }
        })
      }
    })

    await t.test('/api/', async (t) => {
      for (const stage of ['dev', 'pr-x', 'prod']) {
        await t.test(stage, async () => {
          const { stageRoot } = settings(stage)
          for (const event of [
            {
              request: {
                uri: '/api/rest/some-path',
                querystring: {},
                cookies: {},
                headers: {
                  host: {
                    value: stageRoot
                  }
                }
              }
            },
            {
              request: {
                uri: '/api/graphql/query',
                querystring: {},
                cookies: {},
                headers: {
                  host: {
                    value: stageRoot
                  }
                }
              }
            }
          ]) {
            const uri = event.request.uri
            const request = await viewerRequest(
              await cloudfrontFunctionsForStage(stage)
            )(event)

            assert.strict.ok(request.headers['x-now'].value)
            delete request.headers['x-now']

            assert.strict.ok(request.cookies.token.value)
            delete request.cookies.token

            assert.deepEqual(request, {
              uri: `/${stage}${uri}`,
              cookies: {},
              querystring: {},
              headers: {
                ...event.request.headers
              }
            })
          }
        })
      }
    })
    await t.test('ssr', async (t) => {
      for (const stage of ['dev', 'pr-x', 'prod']) {
        await t.test(stage, async () => {
          const { stageRoot } = settings(stage)
          for (const event of [
            {
              request: {
                uri: '/some-path',
                querystring: {},
                cookies: {},
                headers: {
                  host: {
                    value: stageRoot
                  }
                }
              }
            }
          ]) {
            const uri = event.request.uri
            const request = await viewerRequest(
              await cloudfrontFunctionsForStage(stage)
            )(event)

            assert.strict.ok(request.headers['x-now'].value)
            delete request.headers['x-now']

            assert.strict.ok(request.cookies.token.value)
            delete request.cookies.token

            assert.deepEqual(request, {
              uri: `/${stage}${uri}`,
              cookies: {},
              querystring: {},
              headers: {
                ...event.request.headers
              }
            })
          }
        })
      }
    })
    await t.test('webp path no rewritten', async (t) => {
      for (const stage of ['dev', 'pr-x', 'prod']) {
        await t.test(stage, async () => {
          const { stageRoot } = settings(stage)
          for (const event of [
            {
              request: {
                uri: '/media/image.jpg',
                querystring: {},
                cookies: {},
                headers: {
                  host: {
                    value: stageRoot
                  },
                  accept: {
                    value: 'image/webp'
                  }
                }
              }
            },
            ...[
              '/media/x4/image.jpg',
              '/media/x4/image.jpeg',
              '/media/x4/image.gif',
              '/media/x4/image.png'
            ].map(() => ({
              request: {
                uri: '/media/x4/image.jpg',
                querystring: {},
                cookies: {},
                headers: {
                  host: {
                    value: stageRoot
                  }
                }
              }
            }))
          ]) {
            const uri = event.request.uri
            const request = await viewerRequest(
              await cloudfrontFunctionsForStage(stage)
            )(event)

            assert.strict.ok(request.headers['x-now'].value)
            delete request.headers['x-now']

            assert.strict.ok(request.cookies.token.value)
            delete request.cookies.token

            assert.deepEqual(request, {
              uri,
              cookies: {},
              querystring: {},
              headers: {
                ...event.request.headers
              }
            })
          }
        })
      }
    })
    await t.test('webp path rewritten', async (t) => {
      for (const stage of ['dev', 'pr-x', 'prod']) {
        await t.test(stage, async () => {
          const { stageRoot } = settings(stage)
          for (const event of [
            '/media/x4/image.jpg',
            '/media/x4/image.jpeg',
            '/media/x4/image.gif',
            '/media/x4/image.png'
          ].map(() => ({
            request: {
              uri: '/media/x4/image.jpg',
              querystring: {},
              cookies: {},
              headers: {
                host: {
                  value: stageRoot
                },
                accept: {
                  value: 'image/webp'
                }
              }
            }
          }))) {
            const uri = event.request.uri
            const request = await viewerRequest(
              await cloudfrontFunctionsForStage(stage)
            )(event)

            assert.strict.ok(request.headers['x-now'].value)
            delete request.headers['x-now']

            assert.strict.ok(request.cookies.token.value)
            delete request.cookies.token

            assert.deepEqual(request, {
              uri: path.join(
                path.dirname(uri),
                `${path.basename(uri, path.extname(uri))}.webp`
              ),
              cookies: {},
              querystring: {},
              headers: {
                ...event.request.headers
              }
            })
          }
        })
      }
    })
    await t.test('jwt protected routes with no token', async (t) => {
      for (const stage of ['dev', 'pr-x', 'prod']) {
        await t.test(stage, async () => {
          const { stageRoot } = settings(stage)
          for (const event of [
            '/media/~/content.x',
            '/any-path.map',
            '/static/js/~/x.js',
            '/static/media/~/context.x',
            '/static/css/~/x.css'
          ].map((uri) => ({
            request: {
              uri,
              querystring: {},
              cookies: {},
              headers: {
                host: {
                  value: stageRoot
                }
              }
            }
          }))) {
            const response = await viewerRequest(
              await cloudfrontFunctionsForStage(stage)
            )(event)

            assert.deepEqual(response, {
              statusCode: 403,
              statusDescription: 'Forbidden'
            })
          }
        })
      }
    })
    await t.test('invalid token', async (t) => {
      for (const stage of ['dev', 'pr-x', 'prod']) {
        await t.test(stage, async () => {
          const { stageRoot } = settings(stage)
          for (const event of [
            {
              request: {
                uri: '/',
                querystring: {},
                cookies: {
                  token: {
                    value: 'invalid jwt token'
                  }
                },
                headers: {
                  host: {
                    value: stageRoot
                  }
                }
              }
            },
            {
              request: {
                uri: '/',
                querystring: {
                  token: {
                    value: 'invalid jwt token'
                  }
                },
                cookies: {},
                headers: {
                  host: {
                    value: stageRoot
                  }
                }
              }
            },
            {
              request: {
                uri: '/',
                querystring: {},
                cookies: {
                  token: {
                    value: jwt({
                      stage,
                      id: 'user-id',
                      role: 1,
                      v: 'non existing version'
                    })
                  }
                },
                headers: {
                  host: {
                    value: stageRoot
                  }
                }
              }
            },
            {
              request: {
                uri: '/',
                querystring: {},
                cookies: {
                  token: {
                    value: jwt({
                      stage,
                      id: 'user-id',
                      role: 1
                    })
                  }
                },
                headers: {
                  host: {
                    value: stageRoot
                  }
                }
              }
            },
            {
              request: {
                uri: '/',
                querystring: {},
                cookies: {
                  token: {
                    value: jwt({
                      stage,
                      id: 'user-id',
                      role: 1,
                      v: '1',
                      nbf: (Date.now() + 86_400_000) / 1000
                    })
                  }
                },
                headers: {
                  host: {
                    value: stageRoot
                  }
                }
              }
            },
            {
              request: {
                uri: '/',
                querystring: {},
                cookies: {
                  token: {
                    value: jwt({
                      stage,
                      id: 'user-id',
                      role: 1,
                      v: '1',
                      exp: 0
                    })
                  }
                },
                headers: {
                  host: {
                    value: stageRoot
                  }
                }
              }
            }
          ]) {
            const functions = await cloudfrontFunctionsForStage(stage)
            const request = await viewerRequest(functions)(event)

            delete request.querystring.token

            assert.strict.ok(request.headers['x-now'].value)
            delete request.headers['x-now']

            const blankToken = keyValueStore.config.anonymousTokenString

            assert.strictEqual(request.cookies.token.value, blankToken)
          }
        })
      }
    })
    await t.test('valid token resigned', async (t) => {
      for (const stage of ['dev', 'pr-x', 'prod']) {
        const nbf = Date.now() / 1000
        const exp = nbf + 1
        const token = jwt({
          stage,
          id: 'user-id',
          role: 1,
          v: '1',
          nbf,
          exp
        })
        await t.test(stage, async () => {
          const { stageRoot } = settings(stage)
          for (const event of [
            {
              request: {
                uri: '/',
                querystring: {},
                cookies: {
                  token: { value: token }
                },
                headers: {
                  host: {
                    value: stageRoot
                  }
                }
              }
            },
            {
              request: {
                uri: '/',
                querystring: {
                  token: {
                    value: token
                  }
                },
                cookies: {},
                headers: {
                  host: {
                    value: stageRoot
                  }
                }
              }
            }
          ]) {
            const functions = await cloudfrontFunctionsForStage(stage)
            const request = await viewerRequest(functions)(event)

            delete request.querystring.token

            assert.strict.ok(request.headers['x-now'].value)
            delete request.headers['x-now']

            const segments = request.cookies.token.value.split('.')

            assert.strictEqual(segments.length, 3)

            const signature = segments.at(-1)
            const payload = JSON.parse(Buffer.from(segments[1], 'base64url'))

            assert.deepEqual(payload, {
              id: 'user-id',
              role: 1,
              v: '1',
              nbf,
              exp
            })

            const signed = crypto
              .createHmac('sha256', `cf:${stage}-secret`)
              .update(segments.slice(0, -1).join('.'))
              .digest('base64url')

            assert.strictEqual(signature, signed)
          }
        })
      }
    })
    await t.test('protected paths', async (t) => {
      for (const stage of ['dev', 'pr-x', 'prod']) {
        const token = jwt({
          stage,
          id: 'id',
          role: '1',
          v: '1'
        })
        const functions = await cloudfrontFunctionsForStage(stage)
        const handler = viewerRequest(functions)
        const { stageRoot } = settings(stage)
        const createEvent = createEventCreator(token, stageRoot)
        await t.test(stage, async () => {
          {
            const request = await handler(
              createEvent('/media/~/role/1/content.x')
            )
            assert.strict.ok(request.statusCode !== 403)
          }
          {
            const request = await handler(
              createEvent('/media/~/user/id/content.x')
            )
            assert.strict.ok(request.statusCode !== 403)
          }
          {
            const request = await handler(createEvent('/static/js/~/1/x.js'))
            assert.strict.ok(request.statusCode !== 403)
          }
          {
            const request = await handler(createEvent('/static/css/~/1/x.css'))
            assert.strict.ok(request.statusCode !== 403)
          }
          {
            const request = await handler(
              createEvent('/static/media/~/1/context.x')
            )
            assert.strict.ok(request.statusCode !== 403)
          }
          {
            const request = await handler(
              createEvent('/media/~/role/2/content.x')
            )
            assert.strictEqual(request.statusCode, 403)
          }
          {
            const request = await handler(
              createEvent('/media/~/user/x/content.x')
            )
            assert.strictEqual(request.statusCode, 403)
          }
          {
            const request = await handler(createEvent('/static/js/~/2/x.js'))
            assert.strictEqual(request.statusCode, 403)
          }
          {
            const request = await handler(
              createEvent('/static/js/~/1/x.js.map')
            )
            assert.strictEqual(request.statusCode, 403)
          }
          {
            const request = await handler(createEvent('/static/css/~/2/x.css'))
            assert.strictEqual(request.statusCode, 403)
          }
          {
            const request = await handler(
              createEvent('/static/media/~/2/context.x')
            )
            assert.strictEqual(request.statusCode, 403)
          }
          {
            const request = await handler({
              request: {
                uri: '/static/js/~/1/x.js.map',
                querystring: {
                  token: {
                    value: jwt({
                      stage,
                      id: 'id',
                      role: (1 << 30).toString(),
                      v: '1'
                    })
                  }
                },
                cookies: {},
                headers: {
                  host: {
                    value: stageRoot
                  }
                }
              }
            })
            assert.strict.ok(request.statusCode !== 403)
          }
        })
      }
    })
  })
})

await test('viewer response', async (t) => {
  for (const stage of ['dev', 'prod']) {
    const handler = viewerResponse(await cloudfrontFunctionsForStage(stage))
    const request = {
      uri: '/some-uri',
      headers: {
        'x-now': { value: Date.now() - 10 }
      }
    }
    const response = await handler({
      request,
      response: {
        headers: {
          'x-amz-meta-id': { value: '1' },
          'x-header': { value: '42' }
        }
      }
    })

    assert.strict.ok(response.headers['server-timing'].value)
    delete response.headers['server-timing']

    if (stage === 'dev') {
      const debugHeader = JSON.parse(response.headers['x-cf-res'].value)
      assert.strict.ok(debugHeader.response.headers['server-timing'].value)
      delete debugHeader.response.headers['server-timing']
      assert.deepEqual(debugHeader, {
        request,
        response: {
          headers: {
            'x-amz-meta-id': { value: '1' },
            'x-header': { value: '42' }
          }
        }
      })
    }

    delete response.headers['x-cf-res']

    assert.deepEqual(response, {
      headers: {
        'x-header': {
          value: '42'
        }
      }
    })
  }
  await t.test(
    'content-type added when missing for POST requests',
    async (t) => {
      for (const stage of ['dev', 'pr-x', 'prod']) {
        const nbf = Date.now() / 1000
        const exp = nbf + 1
        const token = jwt({
          stage,
          id: 'user-id',
          role: 1,
          v: '1',
          nbf,
          exp
        })
        await t.test(stage, async () => {
          const { stageRoot } = settings(stage)
          for (const event of [
            {
              request: {
                uri: '/api/graphql',
                querystring: {},
                cookies: {
                  token: {
                    value: token
                  }
                },
                method: 'POST',
                headers: {
                  host: {
                    value: stageRoot
                  }
                }
              }
            },
            {
              request: {
                uri: '/api/graphql',
                querystring: {},
                cookies: {
                  token: {
                    value: token
                  }
                },
                method: 'POST',
                headers: {
                  host: {
                    value: stageRoot
                  },
                  'content-type': {
                    value: 'application/json'
                  }
                }
              }
            }
          ]) {
            const functions = await cloudfrontFunctionsForStage(stage)
            const request = await viewerRequest({ request: functions.request })(
              event
            )
            assert.deepEqual(
              request.headers['content-type'].value,
              'application/json'
            )
          }
        })
      }
    }
  )
  await t.test('invalid content-type added for POST requests', async (t) => {
    for (const stage of ['dev', 'pr-x', 'prod']) {
      await t.test(stage, async () => {
        const nbf = Date.now() / 1000
        const exp = nbf + 1
        const token = jwt({
          stage,
          id: 'user-id',
          role: 1,
          v: '1',
          nbf,
          exp
        })
        const { stageRoot } = settings(stage)
        for (const event of [
          {
            request: {
              uri: '/api/graphql',
              querystring: {},
              cookies: {
                token: {
                  value: token
                }
              },
              method: 'POST',
              headers: {
                'content-type': {
                  value: 'application/x-www-form-urlencoded'
                },
                host: {
                  value: stageRoot
                }
              }
            }
          },
          {
            request: {
              uri: '/api/graphql',
              querystring: {},
              cookies: {
                token: {
                  value: token
                }
              },
              method: 'POST',
              headers: {
                'content-type': {
                  value: 'application/jsonx'
                },
                host: {
                  value: stageRoot
                }
              }
            }
          }
        ]) {
          const functions = await cloudfrontFunctionsForStage(stage)
          const request = await viewerRequest({ request: functions.request })(
            event
          )
          assert.deepEqual(request, {
            statusCode: 415,
            statusDescription: 'Unsupported Media Type'
          })
        }
      })
    }
  })
})

function settings(stage) {
  return stage === 'prod'
    ? {
        stageRoot: 'acme.com',
        stageRootUrl: 'https://acme.com',
        stage
      }
    : {
        stageRoot: `${stage}.acme.com`,
        stageRootUrl: 'https://${stage}.acme.com',
        stage
      }
}

async function cloudfrontFunctionsForStage(stage) {
  const code = await getFunctionCode()
  const viewerRequestCode = await code.viewerRequestCode
  const viewerResponseCode = await code.viewerResponseCode

  const { stageRoot, stageRootUrl } = settings(stage)

  for (const key of Object.keys(keyValueStore.config.apiSecrets)) {
    keyValueStore.config.apiSecrets[key] = `${stage}-secret`
  }

  return {
    request: viewerRequestCode
      .replace('${StageRoot}', stageRoot)
      .replace('${StageRootUrl}', stageRootUrl)
      .replace('${Stage}', stage),
    response: viewerResponseCode.replace('${Stage}', stage)
  }
}

function viewerRequest({ request }) {
  return vm.runInNewContext(
    request.replaceAll(
      /import (.*) from (["'])([^"']+)["']/g,
      'const $1 = require($2$3$2)'
    ) + ';handler',
    {
      require(key) {
        if (key === 'crypto') {
          return crypto
        } else if (key === 'cloudfront') {
          return cloudfront()
        }
      },
      Buffer,
      console
    }
  )
}

function viewerResponse({ response }) {
  return vm.runInNewContext(response + ';handler', {
    require(key) {
      if (key === 'crypto') {
        return crypto
      } else if (key === 'cloudfront') {
        return cloudfront()
      }
    },
    Buffer,
    console
  })
}

function jwt({ stage, id, role, v, nbf, exp }) {
  const tokenParts = [
    '{"alg":"HS256","typ":"JWT"}',
    JSON.stringify({
      v,
      id,
      role,
      nbf,
      exp
    })
  ]
    .map((value) => toBase64Url(value))
    .join('.')

  const signature = toBase64Url(
    crypto
      .createHmac('sha256', `${stage}-secret`)
      .update(tokenParts)
      .digest('base64'),
    'base64'
  )

  return tokenParts + '.' + signature
}

function cloudfront() {
  return {
    kvs() {
      return {
        // eslint-disable-next-line @typescript-eslint/require-await
        async get(key) {
          const data = keyValueStore[key]
          if (!data) {
            throw new Error(`${key} not found`)
          }
          return data
        }
      }
    }
  }
}

function createEventCreator(token, stageRoot) {
  return function create(uri) {
    return {
      request: {
        uri,
        querystring: {
          token: {
            value: token
          }
        },
        cookies: {},
        headers: {
          host: {
            value: stageRoot
          }
        }
      }
    }
  }
}

function toBase64Url(string, encoding) {
  return Buffer.from(string, encoding)
    .toString('base64')
    .replaceAll('=', '')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
}
