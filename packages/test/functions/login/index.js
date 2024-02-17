import process from 'node:process'
import './http.js'
import sfn from './sfn.js'
import { SendTaskFailureCommand } from '@aws-sdk/client-sfn'
import lambdaHandler from './lambda-handler.js'

export const handler = lambdaHandler(async function login(
  event,
  _context,
  { abortSignal }
) {
  if (event.email) {
    const res = await fetch(
      `${process.env.BASE_URL}/api/rest/login-by-email?${new URLSearchParams({
        taskToken: event.taskToken
      }).toString()}`,
      {
        signal: abortSignal,
        keepalive: true,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
        },
        method: 'POST',
        body: new URLSearchParams({
          email: event.email
        })
      }
    )

    if (res.status !== 204) {
      await sfn.send(
        new SendTaskFailureCommand({
          taskToken: event.taskToken,
          error: `fetch failed: ${res.status}`
        }),
        { abortSignal }
      )
    }
  }
})
