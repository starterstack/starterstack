import './http.js'
import { Buffer } from 'node:buffer'
import lambdaHandler from './lambda-handler.js'
import sfn from './sfn.js'
import {
  SendTaskSuccessCommand,
  SendTaskFailureCommand
} from '@aws-sdk/client-sfn'
import ms from 'ms'
import * as OTPAuth from 'otpauth'

export const handler = lambdaHandler(async function detail(
  event,
  _context,
  { abortSignal, jsonParse }
) {
  const { email, loginUrl, taskToken } = event.detail
  if (email) {
    const sessionUrl = new URL(loginUrl)
    sessionUrl.pathname = `/api/rest${sessionUrl.pathname}`
    await createSession(sessionUrl)
  }

  async function createSession(sessionUrl) {
    const tokenMatch = /token=([^;]*)/
    const res = await fetch(sessionUrl, {
      signal: abortSignal,
      keepalive: true
    })
    if (res.status === 200) {
      const { secret } = await res.json()
      if (!secret) {
        throw new TypeError(`missing secret ${sessionUrl}`)
      }
      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(secret)
      })

      for (let i = 0; i < 3; i++) {
        const code = totp.generate()
        const res = await fetch(sessionUrl, {
          method: 'POST',
          body: new URLSearchParams({ code }),
          signal: abortSignal,
          keepalive: true
        })
        if (res.status === 204) {
          const token = res.headers.get('set-cookie')?.match(tokenMatch)?.[1]
          await sfn.send(
            new SendTaskSuccessCommand({
              taskToken,
              output: JSON.stringify({
                token,
                ref: jsonParse(Buffer.from(token.split('.')[1], 'base64')).ref,
                ttl: Math.floor((Date.now() + ms('10 minutes')) / 1000)
              })
            }),
            { abortSignal }
          )
          return
        }
      }
    }
    await sfn.send(
      new SendTaskFailureCommand({
        taskToken,
        error: 'login failed'
      }),
      { abortSignal }
    )
  }
})
