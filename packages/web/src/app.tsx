import React from 'react'
import logo from './logo.svg'
import './app.css'
import Link from './link'

export default App

function App({ state: { url } }: { state: { url: string } }) {
  return (
    <div className='App'>
      <header className='App-header'>
        <img src={logo} className='App-logo' alt='logo' />
        <p>url: {url}</p>
        <p>
          <Link pathname='/hello' text='Hello' />
        </p>
        <p>
          <Link pathname='/pingpong' text='Ping' />
        </p>
        <p>
          <a
            className='App-link'
            href='https://reactjs.org'
            target='_blank'
            rel='noopener noreferrer'
          >
            Learn React
          </a>
        </p>
        <p>
          <Link pathname='/styled' text='styled component' />
        </p>
      </header>
    </div>
  )
}
