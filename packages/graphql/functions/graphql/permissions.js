import * as roleHelper from './role-helper.js'

export default function permissions(authorizer) {
  const role = authorizer?.role

  if (Number(role)) {
    return {
      roles: roleHelper.fromTokenValue(role)
    }
  }
}
