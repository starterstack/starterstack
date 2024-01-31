/**
 * @param {string} value
 * @returns {string}
 */

export default function sanitize(value) {
  return value.replaceAll(/["']/g, '')
}
