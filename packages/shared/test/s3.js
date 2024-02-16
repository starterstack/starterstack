import test from 'node:test'
import assert from 'node:assert/strict'
import { CopyObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import s3, { encodeRfc2047 } from '../s3.js'

await test('encoding', () => {
  assert.equal(encodeRfc2047('asciionly'), 'asciionly')
  assert.equal(
    encodeRfc2047('ascii with space'),
    `=?utf-8?b?${Buffer.from('ascii with space').toString('base64')}?=`
  )
  assert.equal(
    encodeRfc2047('LATEST$'),
    `=?utf-8?b?${Buffer.from('LATEST$').toString('base64')}?=`
  )
  assert.equal(encodeRfc2047('dashes-are-ok'), 'dashes-are-ok')
  assert.equal(
    encodeRfc2047(
      '%&!;=~abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.'
    ),
    '%&!;=~abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.'
  )
  assert.equal(
    encodeRfc2047(
      '$%&!;=~abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.'
    ),
    `=?utf-8?b?${Buffer.from(
      '$%&!;=~abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.'
    ).toString('base64')}?=`
  )
  assert.equal(encodeRfc2047(), '')
})

await test('middleware', async (t) => {
  t.beforeEach(() => {
    delete globalThis[Symbol.for('correlationIds')]
  })
  await t.test('anonymous', async (t) => {
    await t.test('put object with no storage class', async () => {
      const command = new PutObjectCommand({
        Bucket: 'bucket',
        Body: 'body',
        Key: 'key',
        ContentType: 'mime',
        CacheControl: 'no-cache',
        Metadata: {}
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

      const middleware = s3.middlewareStack.clone()

      middleware.add(interceptMiddleware)

      const handler = command.resolveMiddleware(middleware, s3.config)

      await handler(command)

      assert.deepEqual(result.input, {
        Body: 'body',
        Bucket: 'bucket',
        CacheControl: 'no-cache',
        ContentType: 'mime',
        Key: 'key',
        Metadata: {},
        StorageClass: 'INTELLIGENT_TIERING'
      })
    })
    await t.test('put object with storage class', async () => {
      const command = new PutObjectCommand({
        Bucket: 'bucket',
        Body: 'body',
        Key: 'key',
        ContentType: 'mime',
        CacheControl: 'no-cache',
        StorageClass: 'STANDARD'
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

      const middleware = s3.middlewareStack.clone()

      middleware.add(interceptMiddleware)

      const handler = command.resolveMiddleware(middleware, s3.config)

      await handler(command)

      assert.deepEqual(result.input, {
        Body: 'body',
        Bucket: 'bucket',
        CacheControl: 'no-cache',
        ContentType: 'mime',
        Key: 'key',
        Metadata: {},
        StorageClass: 'STANDARD'
      })
    })
  })
  await t.test('copy', async (t) => {
    await t.test('copy object with no storage class', async () => {
      const command = new CopyObjectCommand({
        Bucket: 'bucket',
        CopySource: '/bucket/key',
        Key: 'key',
        CacheControl: 'no-cache'
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

      const middleware = s3.middlewareStack.clone()

      middleware.add(interceptMiddleware)

      const handler = command.resolveMiddleware(middleware, s3.config)

      await handler(command)

      assert.deepEqual(result.input, {
        Bucket: 'bucket',
        CacheControl: 'no-cache',
        CopySource: '/bucket/key',
        Key: 'key',
        MetadataDirective: 'COPY',
        StorageClass: 'INTELLIGENT_TIERING',
        TaggingDirective: 'COPY'
      })
    })
    await t.test('copy object with storage class', async () => {
      const command = new CopyObjectCommand({
        Bucket: 'bucket',
        CopySource: '/bucket/key',
        Key: 'key',
        CacheControl: 'no-cache',
        StorageClass: 'STANDARD'
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

      const middleware = s3.middlewareStack.clone()

      middleware.add(interceptMiddleware)

      const handler = command.resolveMiddleware(middleware, s3.config)

      await handler(command)

      assert.deepEqual(result.input, {
        Bucket: 'bucket',
        CacheControl: 'no-cache',
        CopySource: '/bucket/key',
        Key: 'key',
        MetadataDirective: 'COPY',
        StorageClass: 'STANDARD',
        TaggingDirective: 'COPY'
      })
    })
  })
  await t.test('user', async (t) => {
    await t.test(
      'put object with no correlation ids and empty metadata',
      async () => {
        globalThis[Symbol.for('correlationIds')] = {
          'x-correlation-id': 'unique-id',
          'x-correlation-user-id': 'user-id'
        }
        const command = new PutObjectCommand({
          Bucket: 'bucket',
          Body: 'body',
          Key: 'key',
          ContentType: 'mime',
          CacheControl: 'no-cache',
          Metadata: {}
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

        const middleware = s3.middlewareStack.clone()

        middleware.add(interceptMiddleware)

        const handler = command.resolveMiddleware(middleware, s3.config)

        await handler(command)

        assert.deepEqual(result.input, {
          Body: 'body',
          Bucket: 'bucket',
          CacheControl: 'no-cache',
          ContentType: 'mime',
          Key: 'key',
          StorageClass: 'INTELLIGENT_TIERING',
          Metadata: {
            'x-correlation-id': 'unique-id',
            'x-correlation-user-id': 'user-id'
          }
        })
      }
    )
    await t.test('put object with correlation ids', async () => {
      globalThis[Symbol.for('correlationIds')] = {
        'x-correlation-id': 'unique-id',
        'x-correlation-user-id': 'user-id'
      }
      const command = new PutObjectCommand({
        Bucket: 'bucket',
        Body: 'body',
        Key: 'key',
        ContentType: 'mime',
        CacheControl: 'no-cache',
        Metadata: {
          'x-correlation-id-extra': '1'
        }
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

      const middleware = s3.middlewareStack.clone()

      middleware.add(interceptMiddleware)

      const handler = command.resolveMiddleware(middleware, s3.config)

      await handler(command)

      assert.deepEqual(result.input, {
        Body: 'body',
        Bucket: 'bucket',
        CacheControl: 'no-cache',
        ContentType: 'mime',
        Key: 'key',
        StorageClass: 'INTELLIGENT_TIERING',
        Metadata: {
          'x-correlation-id': 'unique-id',
          'x-correlation-user-id': 'user-id',
          'x-correlation-id-extra': '1'
        }
      })
    })
    await t.test('put encoding of metadata', async () => {
      globalThis[Symbol.for('correlationIds')] = {
        'x-correlation-id': 'unique-id',
        'x-correlation-user-id': 'user-id',
        'x-correlation-number': 1,
        'x-correlation-utf-8': 'åäö',
        'x-correlation-null': /* eslint-disable-line unicorn/no-null */ null,
        'x-correlation-undefined': undefined,
        'x-correlation-nan': Number.NaN
      }
      const command = new PutObjectCommand({
        Bucket: 'bucket',
        Body: 'body',
        Key: 'key',
        ContentType: 'mime',
        CacheControl: 'no-cache',
        Metadata: {
          'x-correlation-id-extra': '1'
        }
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

      const middleware = s3.middlewareStack.clone()

      middleware.add(interceptMiddleware)

      const handler = command.resolveMiddleware(middleware, s3.config)

      await handler(command)

      assert.deepEqual(result.input, {
        Body: 'body',
        Bucket: 'bucket',
        CacheControl: 'no-cache',
        ContentType: 'mime',
        Key: 'key',
        StorageClass: 'INTELLIGENT_TIERING',
        Metadata: {
          'x-correlation-id': 'unique-id',
          'x-correlation-nan': 'NaN',
          'x-correlation-null': 'null',
          'x-correlation-number': '1',
          'x-correlation-user-id': 'user-id',
          'x-correlation-utf-8': '=?utf-8?b?w6XDpMO2?=',
          'x-correlation-id-extra': '1'
        }
      })

      assert.equal(
        result.input.Metadata['x-correlation-utf-8'],
        encodeRfc2047('åäö')
      )
    })
  })
  await t.test('copy object with storage class and directives', async () => {
    const command = new CopyObjectCommand({
      Bucket: 'bucket',
      CopySource: '/bucket/key',
      Key: 'key',
      MetadataDirective: 'REPLACE',
      TaggingDirective: 'REPLACE',
      CacheControl: 'no-cache',
      StorageClass: 'DEEP_ARCHIVE'
    })

    let result

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const interceptMiddleware = () => (args) => {
      result = args
      return { output: { $metadata: { request: args.request } }, response: '' }
    }

    const middleware = s3.middlewareStack.clone()

    middleware.add(interceptMiddleware)

    const handler = command.resolveMiddleware(middleware, s3.config)

    await handler(command)

    assert.deepEqual(result.input, {
      Bucket: 'bucket',
      CacheControl: 'no-cache',
      CopySource: '/bucket/key',
      Key: 'key',
      MetadataDirective: 'REPLACE',
      StorageClass: 'DEEP_ARCHIVE',
      TaggingDirective: 'REPLACE'
    })
  })
})
