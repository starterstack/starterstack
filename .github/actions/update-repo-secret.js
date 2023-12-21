import sodium from 'libsodium-wrappers'

export default async function updateRepoSecret({
  github,
  context,
  name,
  value,
  dependabot = false
}) {
  const { owner, repo } = context.repo

  const publicKeyArgs = { owner, repo }

  const {
    data: { key_id: keyId, key }
  } = await (dependabot
    ? github.request(
        'GET /repos/{owner}/{repo}/dependabot/secrets/public-key',
        publicKeyArgs
      )
    : github.rest.actions.getRepoPublicKey(publicKeyArgs))

  const encrypted = sodium.crypto_box_seal(
    Buffer.from(value),
    Buffer.from(key, 'base64')
  )

  const updateSecretArgs = {
    owner,
    repo,
    secret_name: name,
    encrypted_value: Buffer.from(encrypted).toString('base64'),
    key_id: keyId
  }

  await (dependabot
    ? github.request(
        'PUT /repos/{owner}/{repo}/dependabot/secrets/{secret_name}',
        updateSecretArgs
      )
    : github.rest.actions.createOrUpdateRepoSecret(updateSecretArgs))
}
