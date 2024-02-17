import assert from 'node:assert/strict'
import WebSocket from 'ws'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default async function assertions(tokens, { abortSignal }) {
  const baseUrl = process.env.BASE_URL.replace(/^https/, 'wss')

  const image = await readFile(path.join(__dirname, 'fixtures', 'logo192-png'))

  const hash = crypto.createHash('sha512').update(image).digest('hex')

  await Promise.all(tokens.map((token) => assertUpload(token)))

  {
    const res = await fetch(
      `${process.env.BASE_URL}/media/~/user/${tokens[0].ref.id}/media-${hash}.png`,
      {
        signal: abortSignal,
        keepalive: true,
        method: 'HEAD',
        headers: {
          cookie: `token=${tokens[0].token}`,
          'content-type': 'application/json'
        }
      }
    )

    assert.equal(res.status, 200)
  }

  {
    const res = await fetch(
      `${process.env.BASE_URL}/media/~/user/${tokens[1].ref.id}/media-${hash}.png`,
      {
        signal: abortSignal,
        keepalive: true,
        method: 'HEAD',
        headers: {
          cookie: `token=${tokens[1].token}`
        }
      }
    )

    assert.equal(res.status, 200)
  }

  {
    const res = await fetch(
      `${process.env.BASE_URL}/media/~/user/${tokens[0].ref.id}/media-${hash}.png`,
      {
        signal: abortSignal,
        keepalive: true,
        method: 'HEAD',
        headers: {
          cookie: `token=${tokens[1].token}`
        }
      }
    )

    assert.equal(res.status, 403)
  }

  {
    const res = await fetch(
      `${process.env.BASE_URL}/media/~/user/${tokens[1].ref.id}/media-${hash}.png`,
      {
        signal: abortSignal,
        keepalive: true,
        method: 'HEAD',
        headers: {
          cookie: `token=${tokens[0].token}`
        }
      }
    )

    assert.equal(res.status, 403)
  }

  async function assertUpload(token) {
    const res = await fetch(`${process.env.BASE_URL}/api/graphql`, {
      signal: abortSignal,
      keepalive: true,
      method: 'POST',
      headers: {
        cookie: `token=${token.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        query: `
          mutation CreatePresignedPost($key: String!, $contentType: String!, $uploadType: UploadType!, $visibility: UploadVisibility!,) {
            upload {
              createPresignedPost(key: $key, contentType: $contentType, uploadType: $uploadType, visibility: $visibility) {
                url
                fields {
                  name
                  value
                }
              }
            }
          }
        `,
        variables: {
          key: 'logo192.png',
          contentType: 'image/png',
          uploadType: 'MEDIA',
          visibility: 'PRIVATE'
        }
      })
    })
    assert.equal(res.status, 200)

    const {
      data: {
        upload: {
          createPresignedPost: { url, fields }
        }
      }
    } = await res.json()

    const { value: key } = fields.find((field) => field.name === 'key')

    const ws = new WebSocket(
      `${baseUrl}/api/ws/graphql`,
      'graphql-transport-ws',
      {
        headers: {
          cookie: `token=${token.token}`,
          'User-Agent': 'node'
        }
      }
    )
    const open = await new Promise((resolve) => {
      ws.on('open', () => resolve(true))
      ws.on('error', () => resolve(false))
    })
    assert.ok(open)
    {
      const onPong = new Promise((resolve) => {
        ws.on('message', resolve)
      })
      ws.send(JSON.stringify({ type: 'ping', extra: '' }))

      const pong = await onPong

      assert.equal(pong.toString(), JSON.stringify({ type: 'pong' }))
    }

    {
      const onConnectionAck = new Promise((resolve) => {
        ws.on('message', resolve)
      })
      ws.send(JSON.stringify({ type: 'connection_init' }))
      const ack = await onConnectionAck
      assert.equal(ack.toString(), JSON.stringify({ type: 'connection_ack' }))
    }

    const onPong = new Promise((resolve) => ws.on('message', resolve))

    const uuid = crypto.randomUUID()
    ws.send(
      JSON.stringify({
        id: uuid,
        type: 'subscribe',
        payload: {
          query: `subscription ($path: String!, $fireOnce: Boolean!, $subscriptionId: String!) {
             upload(fireOnce: $fireOnce, subscriptionId: $subscriptionId) {
               onReady(path: $path) {
                 files {
                   name
                   path
                 }
               }
             }
          }`,
          variables: {
            path: key,
            fireOnce: false,
            subscriptionId: 'unique-uuid'
          }
        }
      })
    )

    const pong = await onPong
    assert.equal(
      pong.toString(),
      JSON.stringify({
        type: 'pong',
        payload: { subscriptionId: uuid }
      })
    )
    const form = new FormData()
    for (const { name, value } of fields) {
      form.append(name, value)
    }

    const file = new Blob([image.buffer], { type: 'image/png' })

    form.append('file', file)
    {
      const [messages, res] = await Promise.all([
        new Promise((resolve) => {
          const result = []
          ws.on('message', (message) => {
            const {
              payload: {
                data: {
                  upload: { onReady }
                }
              }
            } = JSON.parse(message)

            if (result.length < 2) {
              result.push({
                payload: {
                  data: {
                    upload: {
                      onReady: {
                        files: onReady.files.sort((a, b) =>
                          a.path.localeCompare(b.path)
                        )
                      }
                    }
                  }
                }
              })
            }
            if (result.length === 2) {
              resolve(result)
            }
          })
        }),
        fetch(url, {
          method: 'POST',
          body: form,
          signal: abortSignal,
          keepalive: true
        })
      ])

      assert.equal(res.status, 204)

      const onReady = messages.find(function findOnReady(message) {
        return message.payload.data.upload.onReady.files.length === 5
      })

      assert.deepEqual(onReady, {
        payload: {
          data: {
            upload: {
              onReady: {
                files: [
                  {
                    name: 'original',
                    path: `media/~/user/${token.ref.id}/media-${hash}.png`
                  },
                  {
                    name: 'x1',
                    path: `media/~/user/${token.ref.id}/x1/media-${hash}.jpeg`
                  },
                  {
                    name: 'x2',
                    path: `media/~/user/${token.ref.id}/x2/media-${hash}.jpeg`
                  },
                  {
                    name: 'x3',
                    path: `media/~/user/${token.ref.id}/x3/media-${hash}.jpeg`
                  },
                  {
                    name: 'x4',
                    path: `media/~/user/${token.ref.id}/x4/media-${hash}.jpeg`
                  }
                ]
              }
            }
          }
        }
      })

      const onClose = new Promise((resolve) => {
        ws.on('close', resolve)
      })

      ws.close()

      await onClose
    }
  }
}
