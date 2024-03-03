export default async function createPdf(_, args, context) {
  context.setCacheAge(0)

  return await context.invokeLambda('media', 'CreatePdfFunction', {
    context,
    args
  })
}
