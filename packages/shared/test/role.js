import test from 'node:test'
import assert from 'node:assert/strict'
import * as roleHelper from '../role-helper.js'
import { roleValues } from '../role-mapping.js'

await test('role helper', async (t) => {
  await t.test('from token value', () => {
    assert.deepEqual(
      roleHelper.fromTokenValue(
        roleValues.user | roleValues.admin | roleValues.super
      ),
      ['user', 'admin', 'super']
    )
  })

  await t.test('from context', () => {
    assert.deepEqual(
      roleHelper.fromContext(['user', 'admin']),
      new Set([roleValues.user, roleValues.admin])
    )
  })

  await t.test('from db', () => {
    assert.deepEqual(
      roleHelper.fromDB(new Set([roleValues.user, roleValues.admin])),
      ['user', 'admin']
    )
  })

  await t.test('has role', () => {
    const authenticatedRoles = ['user', 'admin']
    assert.ok(roleHelper.hasRole(authenticatedRoles, ['user', 'admin']))
    assert.ok(roleHelper.hasRole(authenticatedRoles, ['user']))
    assert.ok(roleHelper.hasRole(authenticatedRoles, ['admin']))
    assert.ok(!roleHelper.hasRole(authenticatedRoles, ['super']))
  })
})
