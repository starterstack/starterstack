export default async function createPresignedPost(_, args, context) {
  return await context.invokeLambda('media', 'UploadProgressFunction', {
    args,
    context
  })
}
