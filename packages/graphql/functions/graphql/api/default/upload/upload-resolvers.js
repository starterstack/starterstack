import onUploadReady from './resolvers/subscriptions/on-upload-ready.js'
import createPresignedPost from './resolvers/mutations/create-presigned-post.js'
import progress from './resolvers/queries/progress.js'

export default {
  Mutation: {
    upload: () => ({})
  },
  Query: {
    upload: () => ({})
  },
  Subscription: {
    upload: onUploadReady
  },
  UploadMutations: {
    createPresignedPost
  },
  UploadQueries: {
    progress
  }
}
