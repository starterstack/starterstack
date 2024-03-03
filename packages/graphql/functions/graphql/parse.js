import { parse } from 'graphql'
import ApplicationError from './application-error.js'

export default function parseQuery({ query, log }) {
  try {
    if (!query) {
      throw new Error('missing query')
    }
    return parse(query, { noLocation: true })
  } catch (error) {
    log.error(error)
    throw new ApplicationError('Invalid query', {
      code: 'invalidGraphQLQuery'
    })
  }
}
