import baseUserType from '../../base/user/user-type.js'
const userType = `
    type Query {
        user: UserQueries
    }

    type UserQueries {
      current: User
    }
    ${baseUserType}
`

export default userType
