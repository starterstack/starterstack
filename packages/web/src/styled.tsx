import React from 'react'
import styled from 'styled-components'
import Link from './link'

export default function Styled() {
  return (
    <Background>
      <Container>
        <h1>Testing styled components</h1>
        <p>
          <a
            className='App-link'
            href={'https://styled-components.com'}
            rel='noopener noreferrer'
          >
            styled components
          </a>
        </p>
        <p className='mb1'>Used to test SSR</p>
        <p className='mt0'>FTW</p>
        <p>Thanks!</p>
        <p>
          <Link pathname='/' text='home' />
        </p>
      </Container>
    </Background>
  )
}

const Background = styled.div`
  background-color: #888;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  width: 100vw;
`

const Container = styled.div`
  transform: translateY(-10%);
  max-width: 620px;
  width: 90%;
  background-color: white;
  box-shadow: 0 0 40px 0 rgba(0, 0, 0, 0.18);
  border-radius: 5px;
  padding: 1rem;
  margin: 0 auto;
  text-align: center;
  a {
    color: #1e11e3;
  }
`
