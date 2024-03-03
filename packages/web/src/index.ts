Promise.all(
  [
    typeof window === 'undefined' &&
      import(/* webpackChunkName: "ssr" */ './ssr'),
    typeof window !== 'undefined' &&
      import(/* webpackChunkName: "boot" */ './boot')
  ].filter(Boolean)
).catch(console.error)

export {}
