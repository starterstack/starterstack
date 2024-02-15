import test from 'node:test'
import assert from 'node:assert/strict'
import { SendEmailCommand, SendBulkEmailCommand } from '@aws-sdk/client-sesv2'
import ses from '../ses-v2.js'

await test('ses middleware', async (t) => {
  t.beforeEach(() => {
    delete globalThis[Symbol.for('correlationIds')]
  })
  await t.test('send email', async (t) => {
    await t.test('send templated mail with no correlation ids', async () => {
      const command = new SendEmailCommand({
        Content: {
          Template: {
            TemplateName: 'template',
            TemplateData: JSON.stringify({
              email: 'email'
            })
          }
        },
        Destination: { ToAddresses: ['email'] },
        FromEmailAddress: 'from',
        EmailTags: [
          {
            Name: 'type',
            Value: 'test'
          }
        ]
      })

      let result

      // eslint-disable-next-line unicorn/consistent-function-scoping
      const interceptMiddleware = () => (args) => {
        result = args
        return {
          output: { $metadata: { request: args.request } },
          response: ''
        }
      }

      const middleware = ses.middlewareStack.clone()

      middleware.add(interceptMiddleware)

      const handler = command.resolveMiddleware(middleware, ses.config)

      await handler(command)

      assert.deepEqual(result.input, {
        Content: {
          Template: {
            TemplateData: '{"email":"email"}',
            TemplateName: 'template'
          }
        },
        Destination: {
          ToAddresses: ['email']
        },
        EmailTags: [
          {
            Name: 'type',
            Value: 'test'
          }
        ],
        FromEmailAddress: 'from'
      })
    })
    await t.test('send templated mail with correlation ids', async () => {
      globalThis[Symbol.for('correlationIds')] = {
        'x-correlation-type': '__',
        'x-correlation-id': 'id',
        'x-correlation-source': 'source',
        'x-correlation-raw':
          'åäö/abcdefghijklmnopqrstuvwxyz0123456789~!@#$%^&+*'
      }
      const command = new SendEmailCommand({
        Content: {
          Template: {
            TemplateName: 'template',
            TemplateData: JSON.stringify({
              email: 'email'
            })
          }
        },
        Destination: { ToAddresses: ['email'] },
        FromEmailAddress: 'from',
        EmailTags: [
          {
            Name: 'x-correlation-type',
            Value: 'test'
          }
        ]
      })

      let result

      // eslint-disable-next-line unicorn/consistent-function-scoping
      const interceptMiddleware = () => (args) => {
        result = args
        return {
          output: { $metadata: { request: args.request } },
          response: ''
        }
      }

      const middleware = ses.middlewareStack.clone()

      middleware.add(interceptMiddleware)

      const handler = command.resolveMiddleware(middleware, ses.config)

      await handler(command)

      assert.deepEqual(result.input, {
        Content: {
          Template: {
            TemplateData: '{"email":"email"}',
            TemplateName: 'template'
          }
        },
        Destination: {
          ToAddresses: ['email']
        },
        EmailTags: [
          {
            Name: 'x-correlation-type',
            Value: 'test'
          },
          {
            Name: 'x-correlation-id',
            Value: 'id'
          },
          {
            Name: 'x-correlation-source',
            Value: 'source'
          },
          {
            Name: 'x-correlation-raw',
            Value: 'abcdefghijklmnopqrstuvwxyz0123456789'
          }
        ],
        FromEmailAddress: 'from'
      })
    })
  })
  await t.test('send bulk email', async (t) => {
    await t.test('send templated mail with no correlation ids', async () => {
      const command = new SendBulkEmailCommand({
        BulkEmailEntries: [
          {
            Destination: { ToAddresses: ['email'] }
          }
        ],
        DefaultContent: {
          Template: {
            TemplateName: 'template',
            TemplateData: JSON.stringify({
              email: 'email'
            })
          }
        },
        FromEmailAddress: 'from',
        DefaultEmailTags: [
          {
            Name: 'type',
            Value: 'test'
          }
        ]
      })

      let result

      // eslint-disable-next-line unicorn/consistent-function-scoping
      const interceptMiddleware = () => (args) => {
        result = args
        return {
          output: { $metadata: { request: args.request } },
          response: ''
        }
      }

      const middleware = ses.middlewareStack.clone()

      middleware.add(interceptMiddleware)

      const handler = command.resolveMiddleware(middleware, ses.config)

      await handler(command)

      assert.deepEqual(result.input, {
        BulkEmailEntries: [
          {
            Destination: {
              ToAddresses: ['email']
            }
          }
        ],
        DefaultContent: {
          Template: {
            TemplateData: '{"email":"email"}',
            TemplateName: 'template'
          }
        },
        DefaultEmailTags: [
          {
            Name: 'type',
            Value: 'test'
          }
        ],
        FromEmailAddress: 'from'
      })
    })
    await t.test('send templated mail with correlation ids', async () => {
      globalThis[Symbol.for('correlationIds')] = {
        'x-correlation-type': '__',
        'x-correlation-id': 'id',
        'x-correlation-source': 'source',
        'x-correlation-raw':
          'åäö/abcdefghijklmnopqrstuvwxyz0123456789~!@#$%^&+*'
      }
      const command = new SendBulkEmailCommand({
        DefaultContent: {
          Template: {
            TemplateName: 'template',
            TemplateData: JSON.stringify({
              email: 'email'
            })
          }
        },
        BulkEmailEntries: [
          {
            Destination: { ToAddresses: ['email'] }
          }
        ],
        FromEmailAddress: 'from',
        DefaultEmailTags: [
          {
            Name: 'x-correlation-type',
            Value: 'test'
          }
        ]
      })

      let result

      // eslint-disable-next-line unicorn/consistent-function-scoping
      const interceptMiddleware = () => (args) => {
        result = args
        return {
          output: { $metadata: { request: args.request } },
          response: ''
        }
      }

      const middleware = ses.middlewareStack.clone()

      middleware.add(interceptMiddleware)

      const handler = command.resolveMiddleware(middleware, ses.config)

      await handler(command)

      assert.deepEqual(result.input, {
        BulkEmailEntries: [
          {
            Destination: {
              ToAddresses: ['email']
            }
          }
        ],
        DefaultContent: {
          Template: {
            TemplateData: '{"email":"email"}',
            TemplateName: 'template'
          }
        },
        DefaultEmailTags: [
          {
            Name: 'x-correlation-type',
            Value: 'test'
          }
        ],
        FromEmailAddress: 'from'
      })
    })
  })
})
