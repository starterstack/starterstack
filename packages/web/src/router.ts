import { FC } from 'react'

const cache: { [key: string]: { default: FC<{ state: any }> } } = {}
export default async function router(url: string): Promise<FC<{ state: any }>> {
  const match = cache[url]
  if (!match) {
    if (url.startsWith('/hello')) {
      cache[url] = await import(/* webpackChunkName: "hello" */ './hello')
    } else if (url.startsWith('/upload/')) {
      cache[url] = await import(/* webpackChunkName: "styled" */ './upload')
    } else if (url.startsWith('/uploaded/')) {
      cache[url] = await import(/* webpackChunkName: "styled" */ './uploaded')
    } else if (url === '/styled') {
      cache[url] = await import(/* webpackChunkName: "styled" */ './styled')
    } else if (url === '/pingpong') {
      cache[url] = await import(/* webpackChunkName: "styled" */ './ping')
    } else if (url.startsWith('/session')) {
      cache[url] = await import(/* webpackChunkName: "styled" */ './session')
    } else {
      cache[url] = await import(/* webpackChunkName: "app" */ './app')
    }
  }
  return cache[url].default
}
