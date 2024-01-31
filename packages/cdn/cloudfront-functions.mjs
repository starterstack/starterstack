/** @type {import('@starterstack/sam-expand/resolve').FileResolver} */
export default async function({
  template,
  templateDirectory,
  argv,
  region: defaultRegion
}) {
  return {
    get requestCode() {
      return '//'
    },
    get responseCode() {
      return '//'
    }
  }
}
