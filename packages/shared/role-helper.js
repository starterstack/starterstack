// @ts-check
import roles, { roleValues } from './role-mapping.js'

/**
 * @param {string | undefined} role
 * @returns {Array<string>}
 **/
export function fromTokenValue(role) {
  return Object.entries(roles)
    .map(([key, value]) =>
      /* don't include notauthorized here */ Number(key) &&
      (Number(role) & Number(key)) === Number(key)
        ? value
        : ''
    )
    .filter(Boolean)
}

/**
 * @param {string[]} names
 * @returns {Set<number>}
 **/
export function fromContext(names) {
  return new Set(
    names.length > 0
      ? names.map(function mapRole(name) {
          return roleValues[name]
        })
      : [0]
  )
}

/**
 * @param {Set<number>} role
 * @returns {Array<string>}
 **/
export function fromDB(role) {
  return role
    ? [...role].map(function mapRole(name) {
        return roles[name]
      })
    : []
}

/**
 * @param {string[]} authenticatedRoles
 * @param {string[]} roles
 * @returns {boolean}
 **/
export function hasRole(authenticatedRoles, roles) {
  return [...roles].every(function hasRole(role) {
    return authenticatedRoles?.includes(role)
  })
}
