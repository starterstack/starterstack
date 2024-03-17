import process from 'node:process'
import { SendEmailCommand } from '@aws-sdk/client-sesv2'
import ses from './ses-v2.js'
import lambdaHandler from './lambda-handler.js'

const { SES_HELLO_TEMPLATE_EN, SES_EMAIL_FROM } = process.env

export const handler = lambdaHandler(async function helloEvent(
  event,
  context,
  { log, abortSignal }
) {
  log.debug({ event }, 'received')

  try {
    const { email, team } = event.detail

    await ses.send(
      new SendEmailCommand({
        Content: {
          Template: {
            TemplateName: SES_HELLO_TEMPLATE_EN,
            TemplateData: JSON.stringify({
              email,
              team
            })
          }
        },
        Destination: { ToAddresses: [email] },
        FromEmailAddress: SES_EMAIL_FROM
      }),
      {
        abortSignal
      }
    )

    return {}
  } catch (error) {
    log.error({ event }, error)
    throw error
  }
})
