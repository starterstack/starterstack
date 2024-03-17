/**
 * @param { string } urlPrefix
 * @param { any } fetch
 * @param { Crypto } crypto
 * @returns { (url: string, currentState?: any) => Promise<any> }
 */
export default function createFetchData(urlPrefix, fetch, crypto) {
  /** @type{(url: string, currentState?: any) => Promise<any> } */
  return async function fetchData(url, currentState) {
    /** @type {any} */
    const state = {
      authenticated: false,
      ...currentState,
      url
    }
    if (!currentState) {
      const searchParams = new URLSearchParams({
        query: `query { user { current { email roles } } }`
      })
      const res = await fetch(`${urlPrefix}/api/graphql?${searchParams}`, {
        headers: {
          Accept: 'application/json; charset=UTF8'
        },
        signal: AbortSignal.timeout(10000),
        keepalive: true
      })
      if (res.status !== 200 && res.status !== 403) {
        state.hello = 'sorry no world (bad fetch)'
        state.cache = 'no-cache'
      } else if (res.status === 200) {
        const json = await res.json()
        const currentUser = json.data.user.current
        if (currentUser) {
          state.hello = `hello ${currentUser.email}`
          state.authenticated = true
        } else {
          state.hello = 'world'
        }
        state.cache = 'public, max-age=0, s-maxage=30'
      }
    }
    async function presignedPost({
      key,
      uploadType,
      visibility,
      contentType,
      redirect
    }) {
      const res = await fetch(`${urlPrefix}/api/graphql`, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json; charset=UTF8'
        },
        signal: AbortSignal.timeout(10000),
        keepalive: true,
        method: 'POST',
        body: JSON.stringify({
          query: `mutation CreatePresignedPost(
                  $key: String!
                  $uploadType: UploadType!
                  $visibility: UploadVisibility!
                  $id: String
                  $redirect: Boolean
                  $contentType: String!
                ) {
                  upload {
                    createPresignedPost(
                      key: $key
                      uploadType: $uploadType
                      visibility: $visibility
                      id: $id
                      redirect: $redirect
                      contentType: $contentType
                    ) {
                      url
                      fields {
                        name
                        value
                      }
                    }
                  }
                }
            `,
          variables: {
            key,
            uploadType,
            visibility,
            contentType,
            redirect
          }
        })
      })
      if (res.status === 200) {
        const json = await res.json()
        return json.data.upload.createPresignedPost
      } else {
        throw new Error('failed to fetch')
      }
    }
    if (url.includes('/upload/')) {
      const visibility = url.includes('users') ? 'USERS' : 'PRIVATE'
      state.refreshPresignedPost = async function refreshPresignedPost({
        key,
        contentType,
        redirect
      }) {
        state.presignedPost = await presignedPost({
          key,
          contentType,
          uploadType: 'MEDIA',
          visibility,
          redirect
        })
        return state.presignedPost
      }
      if (!currentState) {
        try {
          await state.refreshPresignedPost({
            key: crypto.randomUUID(),
            contentType: '',
            redirect: true
          })
        } catch (err) {
          state.error = err.message
        }
      }
    } else if (url.startsWith('/uploaded')) {
      const key = url.split('/')[2]?.split('?')?.[0]
      const searchParams = new URLSearchParams({
        query: `
          query UploadProgress($key: String!) {
            upload {
              progress(key: $key) {
                files {
                  name
                  path
                }
              }
            }
          }`,
        variables: JSON.stringify({ key: decodeURIComponent(key) })
      })
      const res = await fetch(`${urlPrefix}/api/graphql?${searchParams}`, {
        headers: {
          Accept: 'application/json; charset=UTF8'
        },
        signal: AbortSignal.timeout(10000),
        keepalive: true
      })
      if (res.status !== 200) {
        state.error = 'sorry, failed to get upload status'
      } else if (res.status === 200) {
        const json = await res.json()
        state.files = json.data.upload.progress.files
        if (typeof window === 'undefined') {
          if (state.files.length === 0) {
            state[Symbol.for('refresh')] = 5
          }
        } else {
          setTimeout(() => window.location.reload(), 5000)
        }
      }
    } else if (url.startsWith('/pingpong')) {
      const res = await fetch(urlPrefix + '/api/rest/ping', {
        credentials: 'omit',
        signal: AbortSignal.timeout(10000),
        keepalive: true
      })
      state.ping = await res.text()
      state.cache = 'no-cache'
    } else if (url.startsWith('/hello')) {
      async function sayHi(language) {
        try {
          const res = await fetch(`${urlPrefix}/api/rest/hello-${language}`, {
            signal: AbortSignal.timeout(10000),
            keepalive: true
          })
          const { hello } = await res.json()
          state.hi = hello
        } catch (err) {
          state.error = `sorry Say hi to ${language} failed`
        }
      }

      if (url.startsWith('/hello/python')) {
        await sayHi('python')
      } else if (url.startsWith('/hello/download/fake-invoice')) {
        try {
          const res = await fetch(`${urlPrefix}/api/graphql`, {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json; charset=UTF8'
            },
            signal: AbortSignal.timeout(10000),
            keepalive: true,
            method: 'POST',
            body: JSON.stringify({
              query: 'mutation { invoice { createPdf } }'
            })
          })
          if (res.status === 200) {
            const json = await res.json()
            const url = json.data.invoice.createPdf
            if (typeof window === 'undefined') {
              state[Symbol.for('redirect')] = url
            } else {
              window.location.href = url
            }
          } else {
            throw new Error('download pdf failed')
          }
        } catch (err) {
          state.error = 'sorry download pdf failed'
        }
      }
    } else if (url.startsWith('/session')) {
      state.cache = 'no-cache'
      const token = url.split('?token=')[1]
      state.token = token
      const res = await fetch(`${urlPrefix}/api/rest/session?token=${token}`, {
        signal: AbortSignal.timeout(10000),
        keepalive: true
      })
      if (res.status === 200) {
        const session = await res.json()
        state.qrcode = session.qrcode
        state.secret = session.secret
      } else {
        if (res.status < 500) {
          const { message } = await res.json()
          state.error = message || 'Internal system error'
        } else {
          state.error =
            (await res.text().catch(() => '')) || 'internal system error'
        }
      }
    }
    return state
  }
}
