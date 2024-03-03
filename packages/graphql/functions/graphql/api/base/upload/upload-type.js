const uploadType = `
  type Mutation {
    upload: UploadMutations
  }

  type Subscription {
    upload(fireOnce: Boolean!, subscriptionId: String!): UploadSubscription
  }

  type UploadSubscription {
    onReady(path: String!): UploadFiles
  }

  type UploadMutations {
    createPresignedPost(key: String!, contentType: String!, redirect: Boolean, uploadType: UploadType!, visibility: UploadVisibility!, id: String): PresignedPost!
  }

  type PresignedPost {
    url: String!
    fields: [PresignedPostField!]!
  }

  type PresignedPostField {
    name: String!
    value: String!
  }

  type UploadFile {
    name: String!
    path: String!
  }

  type UploadFiles {
    files: [UploadFile!]!
  }
`

export default uploadType
