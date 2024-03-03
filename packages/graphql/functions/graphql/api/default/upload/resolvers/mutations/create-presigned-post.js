export default async function createPresignedPost(_, args, context) {
  return await context.invokeLambda('media', 'CreatePresignedPostFunction', {
    args,
    context
  })
}
