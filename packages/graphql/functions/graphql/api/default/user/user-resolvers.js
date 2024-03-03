import current from './resolvers/queries/current-user.js'
export default {
  Query: {
    user: () => ({})
  },
  UserQueries: {
    current: current
  }
}
