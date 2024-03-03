import React from 'react'
import './app.css'
import Link from './link'

export default function Uploaded({
  state: { url, error, files = [] }
}: {
  state: {
    url: string
    files: {
      name: string
      path: string
    }[]
    error: string | undefined
  }
}) {
  return (
    <div className='App'>
      <div className='App-header'>
        <p>
          <Link pathname='/' text='Home' />
        </p>
        <p>
          <Link pathname='/hello' text='Hello' />
        </p>
        {files.map((file) => (
          <p key={file.name}>
            <a
              className='App-link'
              rel='noopener noreferrer'
              key={file.name}
              href={`/${file.path}`}
            >
              {file.name}
            </a>
          </p>
        ))}
        {files.length === 0 && <p>No files found yet</p>}
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
