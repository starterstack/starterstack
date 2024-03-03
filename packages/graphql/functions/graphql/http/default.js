import { schema } from '../schemas/default.js'
import { handler as httpHandler } from './http.js'

export const handler = httpHandler({ schema, schemaName: 'default' })
