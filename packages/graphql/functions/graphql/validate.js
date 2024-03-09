import process from 'node:process'
import ApplicationError from './application-error.js'
import sanitizeInput from './sanitize-input.js'

import {
  validate,
  NoSchemaIntrospectionCustomRule,
  FieldsOnCorrectTypeRule
} from 'graphql'

export default async function customValidate({
  schema,
  ast,
  context,
  variables
}) {
  const noIntrospection =
    !context.roles?.includes('super') && !process.env.IS_OFFLINE

  const validationQueue = []

  try {
    return validate(
      schema,
      ast,
      [
        FieldsOnCorrectTypeRule,
        noIntrospection && NoSchemaIntrospectionCustomRule,
        context?.transport !== 'http:POST' && noMutation,
        context?.transport?.startsWith('http') && noSubscription,
        context?.transport === 'ws' && onlySubscription,
        context?.transport === 'http:POST' &&
          sanitizeInput({ schema, ast, context, variables, validationQueue })
      ].filter(Boolean)
    )
  } finally {
    if (validationQueue.length > 0) {
      await Promise.all(validationQueue)
    }
  }
}

function noMutation() {
  return {
    OperationDefinition: {
      leave({ operation }) {
        if (operation === 'mutation') {
          throw new ApplicationError('mutations only allowed with http post')
        }
      }
    }
  }
}

function noSubscription() {
  return {
    OperationDefinition: {
      leave({ operation }) {
        if (operation === 'subscription') {
          throw new ApplicationError('subscriptions not allowed with http')
        }
      }
    }
  }
}

function onlySubscription() {
  return {
    OperationDefinition: {
      leave({ operation }) {
        if (operation !== 'subscription') {
          throw new ApplicationError(
            `${operation} not supported with websockets`
          )
        }
      }
    }
  }
}
