import React, { useState } from 'react'
import './app.css'
import Link from './link'
import * as graphqlWS from 'graphql-ws'

type PresignedPost = {
  url: string
  fields: {
    name: string
    value: string
  }[]
}

export default function Hello({
  state: {
    url,
    presignedPost,
    authenticated,
    refreshPresignedPost,
    error: errorValue
  }
}: {
  state: {
    url: string
    authenticated: boolean
    refreshPresignedPost: (options: {
      key: string
      contentType: string
      redirect: boolean
    }) => Promise<PresignedPost>
    presignedPost: PresignedPost | undefined
    error: string | undefined
  }
}) {
  const [file, setFile] = useState<File | null>(null)
  const [uploaded, setUploaded] = useState<number>(0)
  const [error, setError] = useState<string | undefined>(errorValue)

  async function upload(e: React.SyntheticEvent) {
    e.preventDefault()

    if (!file) {
      return
    }
    setUploaded(2)

    const { url, fields } = await refreshPresignedPost({
      key: file.name,
      contentType: file.type,
      redirect: false
    })

    const keyField = fields.find(function isKeyField(field: {
      name: string
      value: string
    }) {
      return field.name === 'key'
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const newIds: { [key: string]: boolean | undefined } = {}
        const subscribeTimer = setTimeout(() => {
          reject(new Error('timeout'))
        }, 11000)
        const ws = graphqlWS.createClient({
          generateID() {
            const uuid =
              crypto.randomUUID?.() ?? (Math.random() * Date.now()).toString(32)
            newIds[uuid] = true
            return uuid
          },
          url:
            window.location.protocol === 'http:'
              ? `ws://${window.location.host}/api/ws/graphql`
              : `wss://${window.location.hostname}/api/ws/graphql`,
          on: {
            pong(ok: boolean, data: any | undefined) {
              const subscriptionId = String(data?.subscriptionId)
              if (newIds[subscriptionId]) {
                clearTimeout(subscribeTimer)
                delete newIds[subscriptionId]
                resolve()
              }
            }
          }
        })
        const unsubscribe = ws.subscribe(
          {
            query: `subscription OnUploadReady ($path: String!, $fireOnce: Boolean!, $subscriptionId: String!) {
            upload(fireOnce: $fireOnce, subscriptionId: $subscriptionId) {
              onReady(path: $path) {
                files {
                  name
                  path
                }
              }
            }
          }`,
            variables: {
              path: `${keyField!.value}`,
              fireOnce: true,
              subscriptionId: crypto.randomUUID()
            }
          },
          {
            next(data: any) {
              unsubscribe()
              setTimeout(() => {
                window.dispatchEvent(
                  new CustomEvent('navigate', {
                    cancelable: true,
                    detail: {
                      pathname: `/uploaded/${encodeURIComponent(
                        keyField!.value
                      )}`
                    }
                  })
                )
              }, 250)
            },
            error(err: Error) {
              console.error(err)
              setError(`failed to upload ${file.name}`)
            },
            complete() {
              console.log('complete')
            }
          }
        )
      })

      const formData = new FormData()
      for (const { name, value } of fields) {
        formData.append(name, value)
      }

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', url, true)
        xhr.addEventListener('load', () => {
          if (xhr.status < 400) {
            resolve()
          } else {
            reject(new Error('failed to fetch'))
          }
        })
        xhr.upload.addEventListener('error', (err) => reject(err))
        xhr.upload.addEventListener('progress', (e) => {
          const percentage = (e.loaded / e.total) * 100
          setUploaded(Math.min(99, percentage))
        })
        formData.append('file', file, file.name)
        xhr.send(formData)
      })

      setUploaded(99)
    } catch (err) {
      console.error(err)
      setError(`failed to upload ${file.name}`)
    }
  }
  return (
    <div className='App'>
      <div className='App-header'>
        <p>
          <Link pathname='/' text='Home' />
        </p>
        <p>
          <Link pathname='/hello' text='Hello' />
        </p>
        {authenticated && (
          <form
            onSubmit={upload}
            method='POST'
            action={presignedPost && presignedPost.url}
            encType='multipart/form-data'
          >
            {presignedPost &&
              presignedPost.fields.map(function presignedInput({
                name,
                value
              }) {
                return (
                  <input type='hidden' key={name} name={name} value={value} />
                )
              })}
            <button type='button'>
              <label style={{ cursor: 'pointer' }}>
                <small>
                  Select {`${url.includes('public') ? 'public' : 'users'}`} file
                </small>
                {uploaded > 0 && (
                  <hr
                    style={{
                      background: '#00ff88',
                      padding: '1px 0 1px 0',
                      border: 'none',
                      maxWidth: '100%',
                      overflowX: 'hidden',
                      marginRight: `${100 - uploaded}%`
                    }}
                  />
                )}
                <input
                  type='file'
                  name='file'
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    e.preventDefault()
                    const files = e.target.files!
                    if (files.length === 1) {
                      setFile(files[0])
                    }
                  }}
                />
              </label>
            </button>
            <button type='submit' style={{ marginLeft: '10px' }}>
              upload!
            </button>
          </form>
        )}
        {error && (
          <>
            <p>
              <small style={{ color: 'red' }}>{error}</small>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
