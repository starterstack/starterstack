// @ts-check
/**
 * @param {{ items: Array<any>, size: number }} options
 * @returns {Generator<any[], void, unknown>}
 */

export default function* eachSlice({ items, size }) {
  items = [...items]
  while (items.length > 0) {
    const batch = items.splice(0, size)
    yield batch
  }
}
