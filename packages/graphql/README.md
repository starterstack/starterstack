# graphql api

- `/api/graphql/:schema`

- `/api/ws/graphql/:schema`

## custom roles directive

restrict all query, mutation, or subscription

```graphql
extend type Query @roles(required: ["user"])
extend type Mutation @roles(required: ["user"])
extend type Subscription @roles(required: ["user"])
```

or restrict a function

```graphql
type AdminMutations {
  someFunction(id: String!): String! @roles(required: ["admin"])
}
```

## sanitze directives

```graphql
type UserMutations {
  create(email: String! @sanitizeEmail): String! @roles(required: ["admin"])
}
```

## lambda invoke

in resolver

```js
export default async function resolver(root, args, context, ast) {
  return await context.invokeLambda('stack name', 'function name', {
    root, // optional
    args,
    context,
    ast // optional
  })
}
```

in lambda invoked

```js
import lambdaHandler from './lambda-handler.js'
import ApplicationError from './application-error.js'

export const handler = lambdaHandler(async function handler(
  event,
  context,
  { log, abortSignal }
) {
  try {
    log.debug({ event }, 'received')

    // do things

    return {
      cacheAge: 10, // optional cache value for http GET only
      value: {
        // return value of graphql resolver
      }
    }
  } catch (err) {
    log.error({ event }, err)
    // application error has to be returned or internal error will be given
    if (err instanceof ApplicationError) {
      return { applicationError: err }
    }
    throw err
  }
})
```
