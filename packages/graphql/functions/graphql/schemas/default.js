import { makeExecutableSchema } from '@graphql-tools/schema'
import { mergeTypeDefs, mergeResolvers } from '@graphql-tools/merge'

import directiveType from '../api/default/directive/directive-type.js'
import mutationType from './../api/default/mutation/mutation-type.js'
import subscriptionType from './../api/default/subscription/subscription-type.js'

import userType from './../api/default/user/user-type.js'
import userResolvers from './../api/default/user/user-resolvers.js'

import invoiceType from './../api/default/invoice/invoice-type.js'
import invoiceResolvers from './../api/default/invoice/invoice-resolvers.js'

import uploadType from './../api/default/upload/upload-type.js'
import uploadResolvers from './../api/default/upload/upload-resolvers.js'
import directiveTransformer from '../api/default/directive/transformer.js'

const types = [
  directiveType,
  mutationType,
  subscriptionType,
  userType,
  invoiceType,
  uploadType
]
const resolvers = [userResolvers, invoiceResolvers, uploadResolvers]

export const schema = directiveTransformer(
  makeExecutableSchema({
    typeDefs: mergeTypeDefs(types),
    resolvers: mergeResolvers(resolvers)
  })
)
