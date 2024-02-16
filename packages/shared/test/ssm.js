import test from 'node:test'
import assert from 'node:assert/strict'
import { mockClient } from 'aws-sdk-client-mock'

import {
  SSMClient,
  GetParameterCommand,
  ParameterNotFound,
  ParameterVersionNotFound
} from '@aws-sdk/client-ssm'

import ssm from '../ssm.js'

const ssmMock = mockClient(SSMClient)

await test('single get', async () => {
  ssmMock.reset()
  ssmMock
    .on(GetParameterCommand)
    .resolves({ Parameter: { Name: 'hello', Value: 'world', Version: 1 } })
  const { hello: { value, version } = {} } = await ssm.get({
    name: 'hello',
    abortSignal: AbortSignal.timeout(100)
  })

  assert.equal(value, 'world')
  assert.equal(version, 1)
})

await test('multiple get', async () => {
  ssmMock.reset()
  ssmMock
    .on(GetParameterCommand, { Name: 'hello', WithDecryption: true })
    .resolves({ Parameter: { Name: 'hello', Value: 'world', Version: 1 } })
    .on(GetParameterCommand, { Name: 'goodbye', WithDecryption: true })
    .resolves({ Parameter: { Name: 'goodbye', Value: 'world', Version: 2 } })
  const { hello, goodbye } = await ssm.get({
    names: ['hello', 'goodbye'],
    abortSignal: AbortSignal.timeout(100)
  })

  assert.deepEqual(hello, { value: 'world', version: 1 })
  assert.deepEqual(goodbye, { value: 'world', version: 2 })
})

await test('single get with version', async () => {
  ssmMock.reset()
  ssmMock
    .on(GetParameterCommand, { Name: 'hello:7', WithDecryption: true })
    .resolves({ Parameter: { Name: 'hello', Value: 'world', Version: 7 } })
  const { hello } = await ssm.get({
    name: 'hello:7',
    abortSignal: AbortSignal.timeout(100)
  })

  assert.deepEqual(hello, { value: 'world', version: 7 })
})

await test('not found', async () => {
  ssmMock.on(GetParameterCommand).rejects(new ParameterNotFound('not found'))

  try {
    await ssm.get({
      name: 'hello:1',
      abortSignal: AbortSignal.timeout(100)
    })
    throw new Error('parameter not found not thrown')
  } catch (error) {
    assert.ok(error instanceof ParameterNotFound)
  }

  ssmMock.reset()
  ssmMock
    .on(GetParameterCommand)
    .rejects(new ParameterVersionNotFound('version not found'))

  try {
    await ssm.get({
      name: 'hello:1',
      abortSignal: AbortSignal.timeout(100)
    })
    throw new Error('parameter not found not thrown')
  } catch (error) {
    assert.ok(error instanceof ParameterVersionNotFound)
  }
})

await test('cache', async () => {
  ssmMock.reset()
  ssmMock
    .on(GetParameterCommand)
    .resolves({ Parameter: { Name: 'hello', Value: 'world', Version: 1 } })
  await ssm.get({
    name: 'hello',
    abortSignal: AbortSignal.timeout(100)
  })

  ssm.cache.hello.ttl = ssm.cache.hello.ttl > Date.now()

  assert.deepEqual(ssm.cache.hello, {
    ttl: true,
    value: {
      Parameter: {
        Name: 'hello',
        Value: 'world',
        Version: 1
      }
    }
  })

  ssm.clearCache()

  assert.deepEqual(ssm.cache, {})

  ssmMock.reset()
  ssmMock
    .on(GetParameterCommand)
    .resolves({ Parameter: { Name: 'hello', Value: 'world', Version: 1 } })
  await ssm.get({
    name: 'hello',
    abortSignal: AbortSignal.timeout(100)
  })

  ssmMock.reset()
  ssmMock.on(GetParameterCommand).rejects(new Error('cache miss'))

  await ssm.get({
    name: 'hello',
    abortSignal: AbortSignal.timeout(100)
  })

  ssm.cache.hello.ttl = Date.now() - 1

  try {
    await ssm.get({
      name: 'hello',
      abortSignal: AbortSignal.timeout(100)
    })

    throw new Error('should have thrown')
  } catch (error) {
    assert.ok(error.message, 'cache miss')
  }

  ssm.clearCache()

  try {
    await ssm.get({
      name: 'hello',
      abortSignal: AbortSignal.timeout(100)
    })

    throw new Error('should have thrown')
  } catch (error) {
    assert.ok(error.message, 'cache miss')
  }

  assert.deepEqual(ssm.cache, {})
})
