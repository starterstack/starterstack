// @ts-check
/** @type {{[key: string]: string }} */
const roles = {
  1: 'user',
  [1 << 2 /* 4 */]: 'admin',
  [1 << 30 /* 1073741824 */]: 'super'
}

export default roles

export const roleValues = Object.entries(roles).reduce(
  /** @param {{[key: string]: number }} sum */
  (sum, [key, value]) => {
    sum[String(value)] = Number(key)
    return sum
  },
  {}
)
