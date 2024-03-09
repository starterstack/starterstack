import test from 'node:test'
import assert from 'node:assert/strict'
import { parse, execute } from 'graphql'
import { makeExecutableSchema } from '@graphql-tools/schema'
import validate from '../validate.js'
import ApplicationError from '../application-error.js'

/* eslint-disable unicorn/no-null */

function parseQuery(value) {
  return parse(value, { noLocation: true })
}

await test('validate simple query', async () => {
  const ast = parseQuery('query { currentUser { id } }')
  const schema = makeExecutableSchema({
    typeDefs: `
      type User { id: String!  }
      type Query { currentUser: User }
    `
  })

  for (const transport of ['http:GET', 'http:POST', undefined]) {
    const errors = await validate({
      schema,
      ast,
      context: {
        roles: [],
        transport
      },
      variables: {}
    })
    assert(errors.length === 0)
  }
  try {
    await validate({
      schema,
      ast,
      context: {
        roles: [],
        transport: 'ws'
      },
      variables: {}
    })
    throw new Error('mutation should not be allowed in transport ws')
  } catch (error) {
    assert(error instanceof ApplicationError)
  }
})

await test('validate simple mutation', async () => {
  const ast = parseQuery('mutation { updateUser(name: "Bob") }')
  const schema = makeExecutableSchema({
    typeDefs: `
      type User { name: String!  }
      type Mutation { updateUser(name: String!): Boolean!  }
      type Query { currentUser: User }
    `
  })

  const errors = await validate({
    schema,
    ast,
    context: {
      roles: [],
      transport: 'http:POST'
    },
    variables: {}
  })

  assert(errors.length === 0)

  for (const transport of ['http:GET', 'ws', undefined]) {
    try {
      await validate({
        schema,
        ast,
        context: {
          roles: [],
          transport
        },
        variables: {}
      })
      throw new Error(
        `mutation should not be allowed in transport ${transport}`
      )
    } catch (error) {
      assert(error instanceof ApplicationError)
    }
  }
})

await test('introspection', async () => {
  const ast = parseQuery('query { __schema { types { name } } }')

  const schema = makeExecutableSchema({
    typeDefs: `
      type User { name: String!  }
      type Query { currentUser: User }
    `
  })

  process.env.IS_OFFLINE = ''

  const errors = await validate({
    schema,
    ast,
    context: {
      roles: [],
      transport: 'http:'
    },
    variables: {}
  })

  assert.ok(errors.length > 0, 'introspection not allowed for non super users')

  {
    const errors = await validate({
      schema,
      ast,
      context: {
        roles: ['developer'],
        transport: 'http:'
      },
      variables: {}
    })
    assert.ok(errors.length === 0, 'introspection allowed for super user')
  }

  process.env.IS_OFFLINE = '1'

  {
    const errors = await validate({
      schema,
      ast,
      context: {
        roles: [],
        transport: 'http:'
      },
      variables: {}
    })
    assert.ok(errors.length === 0, 'introspection allowed when offline')
  }
})

await test('validate invalid fields in query', async () => {
  const ast = parseQuery('query { xcurrentUser { id } }')
  const schema = makeExecutableSchema({
    typeDefs: `
      type User { id: String!  }
      type Query { currentUser: User }
    `
  })

  const errors = await validate({
    schema,
    ast,
    context: {
      roles: [],
      transport: 'http:'
    },
    variables: {}
  })

  assert.ok(errors.length > 0)
})

await test('validate simple subscription', async () => {
  const ast = parseQuery('subscription { messages(subscriptionId: "x") }')
  const schema = makeExecutableSchema({
    typeDefs: `
      type User { id: String!  }
      type Query { currentUser: User }
      type Subscription { messages(subscriptionId: String!): [String!]! }
    `
  })

  for (const transport of ['http:GET', 'http:POST', undefined]) {
    try {
      await validate({
        schema,
        ast,
        context: {
          roles: [],
          transport: 'http:'
        },
        variables: {}
      })
      throw new Error(
        `subscription should not be allowed for transport ${transport}`
      )
    } catch (error) {
      assert(error instanceof ApplicationError)
    }
  }

  const errors = await validate({
    schema,
    ast,
    context: {
      roles: [],
      transport: 'ws'
    },
    variables: {}
  })

  assert(errors.length === 0)
})

await test('sanitize email directive with valid input', async () => {
  const schema = makeExecutableSchema({
    typeDefs: `
      directive @sanitizeEmail on FIELD_DEFINITION | INPUT_FIELD_DEFINITION | ARGUMENT_DEFINITION
      type User { email: String!  }
      type Mutation {
        updateUser1(email: String! @sanitizeEmail): String!
        updateUser2(input: UpdateProfile!): String!
        updateUser3(input: UpdateProfileNested!): String!
        updateUser4(email: String!): String!
        updateUser5(input: UpdateProfile): String!
        updateUser6(input: UpdateProfileNested): String!
        updateUser7(email: String @sanitizeEmail): String
      }
      type Query { currentUser: User }
      input UpdateProfile {
        email: String! @sanitizeEmail
      }
      input UpdateProfileNested {
        nested: UpdateProfileNested2!
      }
      input UpdateProfileNested2 {
        nested: UpdateProfile!
      }
    `,
    resolvers: {
      Mutation: {
        updateUser1(_, args) {
          return args.email
        },
        updateUser2(_, args) {
          return args.input.email
        },
        updateUser3(_, args) {
          return args.input.nested.nested.email
        },
        updateUser4(_, args) {
          return args.email
        },
        updateUser5(_, args) {
          return args.input.email
        },
        updateUser6(_, args) {
          return args.input.nested.nested.email
        },
        updateUser7(_, args) {
          return args.email
        }
      }
    }
  })

  const validMutations = [
    {
      mutation: 'mutation { assert: updateUser1(email: "bob@bob.net") }',
      expected: 'bob@bob.net'
    },
    {
      mutation:
        'mutation { assert: updateUser2(input: { email: "bob@bob.net" }) }',
      expected: 'bob@bob.net'
    },
    {
      mutation:
        'mutation { assert: updateUser3(input: { nested: { nested: { email: "bob@bob.net" } } }) }',
      expected: 'bob@bob.net'
    },
    {
      mutation: 'mutation { assert: updateUser4(email: "ANY STRING") }',
      expected: 'ANY STRING'
    },
    {
      mutation: 'mutation { assert: updateUser1(email: " Bob@bob.net") }',
      expected: 'bob@bob.net'
    },
    {
      mutation:
        'mutation { assert: updateUser2(input: { email: "   Bob@bob.net  " }) }',
      expected: 'bob@bob.net'
    },
    {
      mutation:
        'mutation { assert: updateUser3(input: { nested: { nested: { email: " Bob@bob.net" } } }) }',
      expected: 'bob@bob.net'
    },
    {
      mutation:
        'mutation UpdateUser($email: String!) { assert: updateUser1(email: $email) }',
      expected: 'bob@bob.net',
      variables: { email: 'bob@bob.net' }
    },
    {
      mutation:
        'mutation UpdateUser($email: String!) { assert: updateUser2(input: { email: $email } ) }',
      expected: 'bob@bob.net',
      variables: { email: 'bob@bob.net' }
    },
    {
      mutation:
        'mutation UpdateUser($input: UpdateProfile!) { assert: updateUser2(input: $input) }',
      expected: 'bob@bob.net',
      variables: { input: { email: 'bob@bob.net' } }
    },
    {
      mutation:
        'mutation UpdateUser($email: String!) { assert: updateUser3(input: { nested: { nested: { email: $email } } }) }',
      expected: 'bob@bob.net',
      variables: { email: 'bob@bob.net' }
    },
    {
      mutation:
        'mutation UpdateUser($input: UpdateProfileNested!) { assert: updateUser3(input: $input) }',
      expected: 'bob@bob.net',
      variables: { input: { nested: { nested: { email: 'bob@bob.net' } } } }
    },
    {
      mutation:
        'mutation UpdateUser($email: String!) { assert: updateUser1(email: $email) }',
      expected: 'bob@bob.net',
      variables: { email: ' Bob@bob.net' }
    },
    {
      mutation:
        'mutation UpdateUser($email: String!) { assert: updateUser2(input: { email: $email }) }',
      expected: 'bob@bob.net',
      variables: { email: '   Bob@bob.net  ' }
    },
    {
      mutation:
        'mutation UpdateUser($email: String!) { assert: updateUser3(input: { nested: { nested: { email: $email } } }) }',
      expected: 'bob@bob.net',
      variables: { email: ' Bob@bob.net' }
    },
    {
      mutation:
        'mutation UpdateUser($input: UpdateProfileNested!) { assert: updateUser3(input: $input) }',
      expected: 'bob@bob.net',
      variables: { input: { nested: { nested: { email: ' Bob@bob.net' } } } }
    },
    {
      mutation:
        'mutation UpdateUser($input: UpdateProfile) { assert: updateUser5(input: $input) }',
      expected: 'bob@bob.net',
      variables: { input: { email: ' Bob@bob.net   ' } }
    },
    {
      mutation:
        'mutation UpdateUser($email: String!) { assert: updateUser5(input: { email: $email }) }',
      expected: 'bob@bob.net',
      variables: { email: ' Bob@bob.net   ' }
    },
    {
      mutation:
        'mutation { assert: updateUser5(input: { email: "   Bob@bob.NeT" }) }',
      expected: 'bob@bob.net'
    },
    {
      mutation:
        'mutation UpdateUser($email: String) { assert: updateUser5(input: { email: $email }) }',
      variables: {
        email: '  Bob@BOB.NET'
      },
      expected: 'bob@bob.net'
    },
    {
      mutation:
        'mutation UpdateUser($input: UpdateProfileNested) { assert: updateUser6(input: $input) }',
      expected: 'bob@bob.net',
      variables: { input: { nested: { nested: { email: ' Bob@bob.net   ' } } } }
    },
    {
      mutation:
        'mutation { assert: updateUser6(input: { nested: { nested: { email: "   BOB@boB.net" } } }) }',
      expected: 'bob@bob.net'
    },
    {
      mutation:
        'mutation UpdateUser($email: String) { assert: updateUser6(input: { nested: { nested: { email: $email } } }) }',
      expected: 'bob@bob.net',
      variables: { email: '   BOB@bob.Net     ' }
    },
    {
      mutation:
        'mutation UpdateUser($email: String) { assert: updateUser7(email: $email) }',
      expected: 'bob@bob.net',
      variables: { email: ' bob@bob.net  ' }
    },
    {
      mutation:
        'mutation UpdateUser($email: String) { assert: updateUser7(email: $email) }',
      expected: null,
      variables: {}
    }
  ]

  await Promise.all(
    validMutations.map(async function assertMutation({
      mutation,
      variables,
      expected
    }) {
      const ast = parseQuery(mutation)
      const errors = await validate({
        schema,
        ast,
        context: {
          roles: [],
          transport: 'http:POST'
        },
        ...(variables && { variables })
      })
      assert(errors.length === 0, mutation)
      const result = await execute({
        schema,
        document: ast,
        rootValue: {},
        contextValue: {},
        ...(variables && { variableValues: variables })
      })

      if (result.errors) {
        throw new Error(
          JSON.stringify({ mutation, errors: result.errors, ast }, null, 2)
        )
      }

      /** @type {string} */
      const email = result.data.assert

      assert.equal(
        email,
        expected,
        `${mutation} expected [${expected}], but got [${email}]\n${JSON.stringify(
          ast,
          null,
          2
        )}`
      )
    })
  )
})

await test('sanitize email directive with invalid input', async () => {
  const schema = makeExecutableSchema({
    typeDefs: `
      directive @sanitizeEmail on FIELD_DEFINITION | INPUT_FIELD_DEFINITION | ARGUMENT_DEFINITION
      type User { email: String!  }
      type Mutation {
        updateUser1(email: String! @sanitizeEmail): String!
        updateUser2(input: UpdateProfile!): String!
        updateUser3(input: UpdateProfileNested!): String!
        updateUser4(email: String!): String!
        updateUser5(input: UpdateProfile): String!
        updateUser6(input: UpdateProfileNested): String!
        updateUser7(email: String @sanitizeEmail): String
      }
      type Query { currentUser: User }
      input UpdateProfile {
        email: String! @sanitizeEmail
      }
      input UpdateProfileNested {
        nested: UpdateProfileNested2!
      }
      input UpdateProfileNested2 {
        nested: UpdateProfile!
      }
    `
  })

  const invalidMutations = [
    {
      mutation: 'mutation { assert: updateUser1(email: "invalid-email") }'
    },
    {
      mutation:
        'mutation { assert: updateUser2(input: { email: "invalid-email" }) }'
    },
    {
      mutation:
        'mutation { assert: updateUser3(input: { nested: { nested: { email: "invalid-email" } } }) }'
    },
    {
      mutation: 'mutation { assert: updateUser1(email: "invalid-email") }'
    },
    {
      mutation:
        'mutation { assert: updateUser2(input: { email: "invalid-email" }) }'
    },
    {
      mutation:
        'mutation { assert: updateUser3(input: { nested: { nested: { email: "invalid-email" } } }) }'
    },
    {
      mutation:
        'mutation UpdateUser($email: String!) { assert: updateUser1(email: $email) }',
      variables: { email: 'invalid-email' }
    },
    {
      mutation:
        'mutation UpdateUser($email: String!) { assert: updateUser2(input: { email: $email } ) }',
      variables: { email: 'invalid-email' }
    },
    {
      mutation:
        'mutation UpdateUser($input: UpdateProfile!) { assert: updateUser2(input: $input) }',
      variables: { input: { email: 'invalid-email' } }
    },
    {
      mutation:
        'mutation UpdateUser($email: String!) { assert: updateUser3(input: { nested: { nested: { email: $email } } }) }',
      variables: { email: 'invalid-email' }
    },
    {
      mutation:
        'mutation UpdateUser($input: UpdateProfileNested!) { assert: updateUser3(input: $input) }',
      variables: { input: { nested: { nested: { email: 'invalid-email' } } } }
    },
    {
      mutation:
        'mutation UpdateUser($email: String!) { assert: updateUser1(email: $email) }',
      variables: { email: 'invalid-email' }
    },
    {
      mutation:
        'mutation UpdateUser($email: String!) { assert: updateUser2(input: { email: $email }) }',
      variables: { email: 'invalid-email' }
    },
    {
      mutation:
        'mutation UpdateUser($email: String!) { assert: updateUser3(input: { nested: { nested: { email: $email } } }) }',
      variables: { email: 'invalid-email' }
    },
    {
      mutation:
        'mutation UpdateUser($input: UpdateProfileNested!) { assert: updateUser3(input: $input) }',
      variables: { input: { nested: { nested: { email: 'invalid-email' } } } }
    },
    {
      mutation:
        'mutation UpdateUser($input: UpdateProfile) { assert: updateUser5(input: $input) }',
      variables: { input: { email: 'invalid-email' } }
    },
    {
      mutation:
        'mutation UpdateUser($email: String!) { assert: updateUser5(input: { email: $email }) }',
      variables: { email: 'invalid-email' }
    },
    {
      mutation:
        'mutation { assert: updateUser5(input: { email: "invalid-email" }) }'
    },
    {
      mutation:
        'mutation UpdateUser($email: String) { assert: updateUser5(input: { email: $email }) }',
      variables: {
        email: 'invalid-email'
      },
      expected: 'invalid-email'
    },
    {
      mutation:
        'mutation UpdateUser($input: UpdateProfileNested) { assert: updateUser6(input: $input) }',
      variables: { input: { nested: { nested: { email: 'invalid-email' } } } }
    },
    {
      mutation:
        'mutation { assert: updateUser6(input: { nested: { nested: { email: "invalid-email" } } }) }'
    },
    {
      mutation:
        'mutation UpdateUser($email: String) { assert: updateUser6(input: { nested: { nested: { email: $email } } }) }',
      variables: { email: 'invalid-email' }
    },
    {
      mutation:
        'mutation UpdateUser($email: String) { assert: updateUser7(email: $email) }',
      variables: { email: 'invalid-email' }
    }
  ]

  await Promise.all(
    invalidMutations.map(async function assertMutation({
      mutation,
      variables
    }) {
      const ast = parseQuery(mutation)

      try {
        await validate({
          schema,
          ast,
          context: {
            roles: [],
            transport: 'http:POST'
          },
          ...(variables && { variables })
        })
        throw new Error(`mutation ${mutation} should catch invalid email`)
      } catch (error) {
        assert(error instanceof ApplicationError, mutation)
      }
    })
  )
})
