import subscribe from '../../../../../subscribe.js'

export default {
  subscribe,
  // eslint-disable-next-line @typescript-eslint/require-await
  async resolve(root) {
    return {
      onReady: {
        files: root.onReady.files.filter((x) => !/web(p|m)$/i.test(x.path))
      }
    }
  }
}
