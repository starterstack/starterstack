import assert from 'node:assert/strict'
import WebSocket from 'ws'
import crypto from 'node:crypto'

export default async function assertions(tokens) {
  const baseUrl = process.env.BASE_URL.replace(/^https/, 'wss')

  await Promise.all(
    tokens.map(async function echo(token) {
      await assertUnsupportedProtocol(token)
      await assertEcho(token)
      await assertGraphQL(token)
    })
  )
  await assertUnauthorized()

  async function assertUnauthorized() {
    const ws = new WebSocket(`${baseUrl}/api/ws/graphql`, {
      headers: {
        'User-Agent': 'node'
      }
    })
    const open = await new Promise((resolve) => {
      ws.on('open', () => resolve(true))
      ws.on('error', () => resolve(false))
    })
    assert.ok(!open)
  }

  async function assertUnsupportedProtocol(token) {
    const ws = new WebSocket(`${baseUrl}/api/ws/graphql`, 'custom-protocol', {
      headers: {
        cookie: `token=${token.token}`,
        'User-Agent': 'node'
      }
    })
    const open = await new Promise((resolve) => {
      ws.on('open', () => resolve(true))
      ws.on('error', () => resolve(false))
    })
    assert.ok(!open)
  }

  async function assertEcho(token) {
    const ws = new WebSocket(`${baseUrl}/api/ws/graphql`, {
      headers: {
        cookie: `token=${token.token}`,
        'User-Agent': 'node'
      }
    })
    const open = await new Promise((resolve) => {
      ws.on('open', () => resolve(true))
      ws.on('error', () => resolve(false))
    })
    assert.ok(open)
    const onMessage = new Promise((resolve) => ws.on('message', resolve))
    const echo = JSON.stringify({ type: 'echo', message: 'ping' })
    ws.send(echo)

    const message = await onMessage
    assert.equal(message.toString(), echo)
  }

  async function assertGraphQL(token) {
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
    {
      const onError = new Promise((resolve) => {
        ws.on('message', resolve)
      })
      const uuid = crypto.randomUUID()

      ws.send(
        JSON.stringify({
          id: uuid,
          type: 'subscribe',
          payload: {
            query: `subscription {
              notExist {
                ok
              }
           }`,
            variables: {}
          }
        })
      )
      const error = JSON.parse(await onError)
      assert.equal(error.type, 'error')
    }

    const onClose = new Promise((resolve) => {
      ws.on('close', resolve)
    })
    ws.close()

    await onClose
  }
}
