import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import jwt from 'jsonwebtoken'
import ssm from '../../shared/ssm.js'

const require = createRequire(import.meta.url)
const { stackName } = require('../../settings.js')()

export default async function verifyJWT(req) {
  const cookieToken = (Object.entries(req.headers).find(
    ([key, value]) => key.toLowerCase() === 'cookie'
  ) || [])[1]?.match(/token=([^;]+)/)?.[1]

  if (!cookieToken) {
    return
  }

  const tokenPayload = JSON.parse(
    Buffer.from(cookieToken.split('.')[1], 'base64')
  )
  const tokenVersion = tokenPayload.v
  const SSM_API_JWT_SECRET = `/${stackName}/local/API_JWT_SECRET`

  const {
    [`${SSM_API_JWT_SECRET}`]: { value: apiSecret }
  } = await ssm.get({
    name: `${SSM_API_JWT_SECRET}:${tokenVersion}`
  })

  const tokenData =
    apiSecret &&
    (await new Promise((resolve) => {
      jwt.verify(
        cookieToken,
        apiSecret,
        { algorithms: ['HS256'] },
        (err, data) => {
          if (err) {
            resolve(undefined)
          } else {
            resolve(data)
          }
        }
      )
    }))

  return tokenData
}
