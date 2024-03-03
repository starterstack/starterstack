import React from 'react'
import './app.css'
import Link from './link'

export default Ping

function Ping({ state: { ping } }: { state: { ping: string | undefined } }) {
  return (
    <div className='App'>
      <div className='App-header'>
        <p>{ping || 'no ping present'}</p>
        <p>
          <Link pathname='/' text='home' />
        </p>
      </div>
    </div>
  )
}
