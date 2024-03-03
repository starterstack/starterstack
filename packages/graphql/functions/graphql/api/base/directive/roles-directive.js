import { mapSchema, getDirective, MapperKind } from '@graphql-tools/utils'
import { defaultFieldResolver } from 'graphql'
import ApplicationError from '../../../application-error.js'

export default function allowedDirective(schema) {
  const directiveName = 'roles'
  const typeDirectiveArgumentMaps = {}
  return mapSchema(schema, {
    [MapperKind.TYPE]: (type) => {
      const directive = getDirective(schema, type, directiveName)?.[0]
      if (directive) {
        typeDirectiveArgumentMaps[type.name] = directive
      }
      return
    },
    [MapperKind.OBJECT_FIELD]: (fieldConfig, _fieldName, typeName) => {
      const directive =
        getDirective(schema, fieldConfig, directiveName)?.[0] ??
        typeDirectiveArgumentMaps[typeName]
      if (directive) {
        const { required } = directive

        if (required) {
          const { resolve = defaultFieldResolver } = fieldConfig

          fieldConfig.resolve = function authResolveDirectiveResolver(
            root,
            args,
            context,
            ast
          ) {
            if (required.every((role) => context?.roles?.includes(role))) {
              return resolve(root, args, context, ast)
            } else {
              const missingRoles = required
                .filter((role) => !context?.roles?.includes(role))
                .join(',')
              throw new ApplicationError(
                `Not Authorized: missing role(s) ${missingRoles}`,
                {
                  code: 'requiresRole',
                  id: missingRoles
                }
              )
            }
          }
          return fieldConfig
        }
      }
    }
  })
}
