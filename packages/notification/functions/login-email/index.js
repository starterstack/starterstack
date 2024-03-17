import process from 'node:process'
import { SendEmailCommand } from '@aws-sdk/client-sesv2'
import ses from './ses-v2.js'
import lambdaHandler from './lambda-handler.js'

const { SES_LOGIN_TEMPLATE_EN, SES_EMAIL_FROM } = process.env

export const handler = lambdaHandler(async function loginEmail(
  event,
  context,
  { abortSignal, log }
) {
  log.debug({ event }, 'received')

  try {
    const { email, loginUrl, team, correlationId } = event.detail

    await ses.send(
      new SendEmailCommand({
        Content: {
          Template: {
            TemplateName: SES_LOGIN_TEMPLATE_EN,
            TemplateData: JSON.stringify({
              email,
              loginUrl,
              team
            })
          }
        },
        Destination: { ToAddresses: [email] },
        FromEmailAddress: SES_EMAIL_FROM,
        EmailTags: [
          {
            Name: 'type',
            Value: 'login'
          },
          {
            Name: 'correlationId',
            Value: correlationId
          }
        ]
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
