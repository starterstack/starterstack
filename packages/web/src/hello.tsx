import React, { useState } from 'react'
import './app.css'
import Link from './link'

export default function Hello({
  state: { url, hello, authenticated, hi, error: errorValue }
}: {
  state: {
    url: string
    hello: string | undefined
    hi: string | undefined
    authenticated: boolean
    error: string | undefined
  }
}) {
  const [checkInbox, setCheckInbox] = useState<boolean>(false)
  const [loggedIn] = useState<boolean>(authenticated)
  const [error, setError] = useState<string | undefined>(errorValue)

  async function login(e: React.SyntheticEvent) {
    e.preventDefault()
    const target = e.target as typeof e.target & {
      email: { value: string }
    }
    const email = target.email.value
    try {
      const res = await fetch('/api/rest/login-by-email', {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        method: 'POST',
        credentials: 'omit',
        signal: AbortSignal.timeout(10000),
        keepalive: true,
        body: new URLSearchParams({ email })
      })
      if (res.status === 204) {
        setError('')
        setCheckInbox(true)
      } else {
        const errorMessage = await res.text()
        setError(`Login failed with ${errorMessage}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'internal system error')
    }
  }

  return (
    <div className='App'>
      <div className='App-header'>
        {loggedIn && <p>{hello}</p>}
        {!loggedIn && <p>hello {hello || 'worldless'}</p>}
        <p>
          <Link pathname='/' text='Home' />
        </p>
        {!loggedIn && (
          <form
            action='/api/rest/login-by-email'
            method='post'
            onSubmit={(e) => login(e)}
          >
            <input
              name='email'
              required
              type='email'
              placeholder='email?'
              autoFocus
            />
            <button>Login/Signup</button>
            {checkInbox && (
              <>
                <h5>Check your inbox!</h5>
                <p>
                  <small>
                    We've sent an email with a login link to your email address.
                  </small>
                </p>
                <p>
                  <small>The link is valid for next 15 minutes.</small>
                </p>
                <p>
                  <small>
                    If the email doesn't show up in your inbox, check your spam
                    folder and try again.
                  </small>
                </p>
              </>
            )}
          </form>
        )}
        {loggedIn && (
          <p>
            <Link
              pathname='/hello/download/fake-invoice'
              text='Download fake invoice pdf'
            />
          </p>
        )}
        {loggedIn && (
          <>
            <p>
              <Link pathname='/upload/private' text='Upload private file' />
            </p>
            <p>
              <Link pathname='/upload/users' text='Upload public file' />
            </p>
          </>
        )}
        <p>
          <Link pathname='/hello/python' text='Say hi to Python' />
        </p>
        <p>
          <Link pathname='/hello/ruby' text='Say hi to Ruby' />
        </p>
        {hi && (
          <>
            <p>
              <small>{hi}</small>
            </p>
          </>
        )}
        {loggedIn && (
          <form action='/api/rest/logout' method='post'>
            <button
              style={{ margin: '30px 0 0 0' }}
              onClick={() => setCheckInbox(false)}
            >
              Logout
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
