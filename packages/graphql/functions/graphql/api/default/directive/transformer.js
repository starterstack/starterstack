import rolesDirective from '../../base/directive/roles-directive.js'

const directives = [rolesDirective]

export default function transformer(schema) {
  return directives.reduce((schema, directive) => directive(schema), schema)
}
