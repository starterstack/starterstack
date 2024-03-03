import baseUploadType from '../../base/upload/upload-type.js'
const uploadType = `
  ${baseUploadType}
  enum UploadType {
    MEDIA
  }

  enum UploadVisibility {
    PRIVATE
    PUBLIC
    USERS
  }

  type Query {
    upload: UploadQueries
  }

  type UploadQueries {
    progress(key: String!): UploadProgress
  }

  type UploadProgress {
    files: [UploadFile!]!
  }
`

export default uploadType
