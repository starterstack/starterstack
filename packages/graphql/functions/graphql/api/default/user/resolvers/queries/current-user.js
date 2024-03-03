// eslint-disable-next-line @typescript-eslint/require-await
export default async function currentUser(_, __, { id, email, roles }) {
  // eslint-disable-next-line unicorn/no-null
  if (!id) return null

  return {
    id,
    email,
    roles
  }
}
