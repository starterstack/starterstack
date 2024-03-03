import React, { useState } from 'react'
import './app.css'
import Link from './link'

export default Session

function Session({
  state: { token, error, qrcode, secret }
}: {
  state: {
    token: string
    qrcode: string | undefined
    secret: string | undefined
    error: string | undefined
  }
}) {
  const [codeError, setCodeError] = useState<string | null>(null)
  async function login(e: React.SyntheticEvent) {
    e.preventDefault()
    const target = e.target as typeof e.target & {
      code: { value: string }
    }
    const code = target.code.value
    try {
      const res = await fetch(`/api/rest/session?token=${token}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        method: 'POST',
        body: new URLSearchParams({ code })
      })
      if (res.status === 204) {
        window.location.href = '/hello'
      } else if (res.status < 500) {
        const { message: errorMessage } = await res.json()
        setCodeError(`Login failed with ${errorMessage}`)
      } else {
        const errorMessage = await res.text()
        setCodeError(`Login failed with ${errorMessage}`)
      }
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : 'internal system error')
    }
  }
  return (
    <div className='App'>
      <div className='App-header'>
        {codeError && <p>Error: {codeError}</p>}
        {error ? (
          <p>{error}</p>
        ) : (
          <>
            <p>MFA authentication</p>
            {qrcode && (
              <>
                <p>Scan this in your authenticator app</p>
                <img src={qrcode} alt='qrcode for mfa' />
                <p>Secret {secret}</p>
              </>
            )}
            <form
              action={'/api/rest/session?token=' + token}
              method='POST'
              onSubmit={(e) => login(e)}
            >
              <input
                name='code'
                required
                type='text'
                placeholder='mfa code?'
                autoComplete='off'
                autoFocus
              />
              <button>Login</button>
            </form>
          </>
        )}
        <p>
          <Link pathname='/' text='home' />
        </p>
      </div>
    </div>
  )
}
