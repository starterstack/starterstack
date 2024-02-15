import test from 'node:test'
import assert from 'node:assert/strict'
import ApplicationError from '../application-error.js'

await test('application error', async (t) => {
  await t.test('has code', () => {
    const error = new ApplicationError('error', { code: 'E_CODE' })
    assert.equal(error.extensions.code, 'E_CODE')
  })

  await t.test('only message', () => {
    const error = new ApplicationError('message')
    assert.equal(error.extensions.code, 'unknown')
    assert.equal(error.extensions.id, undefined)
    assert.equal(error.message, 'message')
  })

  await t.test('has id', () => {
    const error = new ApplicationError('error', { id: 42 })
    assert.equal(error.extensions.code, 'unknown')
    assert.equal(error.extensions.id, 42)
  })

  await t.test('has extended message', () => {
    const error = new ApplicationError('error', {}, { any: 'value' })
    assert.deepEqual(error.extensions.extendedMessage, {
      any: 'value'
    })
  })

  await t.test('json', () => {
    const error = new ApplicationError(
      'some error',
      { code: 'E_CODE', id: 42 },
      { any: 'value' }
    )
    const json = error.toJSON()

    assert.deepEqual(json, {
      extensions: {
        code: 'E_CODE',
        extendedMessage: {
          any: 'value'
        },
        id: 42
      },
      message: 'some error'
    })
  })

  await t.test('instance of', () => {
    const error = new Error('error')
    assert.ok(!(error instanceof ApplicationError))
    error.name = 'ApplicationError'
    assert.ok(error instanceof ApplicationError)
    delete error.name
    error.extensions = new ApplicationError('error').extensions
    assert.ok(error instanceof ApplicationError)
  })
})
