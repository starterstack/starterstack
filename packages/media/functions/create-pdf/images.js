import { Buffer } from 'node:buffer'

export default [
  {
    name: 'background',
    type: 'image/jpeg',
    value: await image('https://picsum.photos/595/841')
  },
  {
    name: 'logo',
    type: 'image/jpeg',
    value: await image('https://picsum.photos/256/256')
  }
]

async function image(url) {
  const data = []
  const res = await fetch(url, {
    signal: AbortSignal.timeout(6000),
    keepalive: true
  })
  for await (const chunk of res.body) {
    data.push(chunk)
  }
  return Buffer.concat(data)
}
