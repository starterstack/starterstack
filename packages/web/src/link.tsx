export default function Link({
  pathname,
  text
}: {
  pathname: string
  text: string
}) {
  return (
    <a
      className='App-link'
      href={pathname}
      rel='noopener noreferrer'
      onClick={(e) => {
        e.preventDefault()
        window.dispatchEvent(
          new CustomEvent('navigate', {
            cancelable: true,
            detail: { pathname }
          })
        )
      }}
    >
      {text}
    </a>
  )
}
