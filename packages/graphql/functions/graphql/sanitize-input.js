import ApplicationError from './application-error.js'

export default function sanitizeInput({ schema, variables }) {
  return function sanitize(context) {
    function parseNode() {
      return {
        enter(node) {
          if (!sanitize) return
          const inputType = context?.getInputType()
          const hits = inputType
            ? getDirectiveInputs(
                schema,
                String(inputType),
                node.value?.kind === 'Variable' ? node.value.name.value : ''
              )
            : []

          for (const { key, directives } of hits) {
            if (node.value?.kind === 'Variable') {
              sanitizeValue({
                value: getValue(key, variables),
                set(newValue) {
                  setValue(key, newValue, variables)
                },
                directives
              })
            } else if (node.value?.kind === 'ObjectValue') {
              const field = node.value.fields.find(function matchField(field) {
                return field.kind === 'ObjectField' && field.name.value === key
              })
              if (field?.value?.kind === 'StringValue') {
                sanitizeValue({
                  value: field.value.value,
                  set(newValue) {
                    field.value.value = newValue
                  },
                  directives
                })
              } else if (field?.value?.kind === 'Variable') {
                sanitizeValue({
                  value: variables[field.value.name.value],
                  set(newValue) {
                    variables[field.value.name.value] = newValue
                  },
                  directives
                })
              }
            }
          }

          if (hits.length === 0) {
            const directives = getSanitizeDirectives(context?.getArgument())

            if (directives.length > 0) {
              if (node.value?.kind === 'StringValue') {
                sanitizeValue({
                  value: node.value.value,
                  set(newValue) {
                    node.value.value = newValue
                  },
                  directives
                })
              } else if (node.value?.kind === 'Variable') {
                const name = node.value.name.value
                sanitizeValue({
                  value: variables[name],
                  set(newValue) {
                    variables[name] = newValue
                  },
                  directives
                })
              }
            }
          }
        }
      }
    }
    let sanitize = false
    return {
      OperationDefinition: {
        enter({ operation }) {
          if (operation === 'mutation') {
            sanitize = true
          }
        }
      },
      ObjectField: parseNode(),
      Argument: parseNode()
    }
  }
}

function getSanitizeDirectives(node) {
  return (
    node?.astNode?.directives
      ?.map(function directiveName(node) {
        return node?.name?.value
      })
      .filter(function matchDirective(name) {
        return name?.startsWith('sanitize')
      }) ?? []
  )
}

function getDirectiveInputs(schema, typeName, parent = '') {
  const results = []
  const prefix = parent ? `${parent}.` : ''
  const type = typeName.endsWith('!') ? typeName.slice(0, -1) : typeName
  const fields = schema.getType(type)?.getFields?.() ?? []
  for (const [name, value] of Object.entries(fields)) {
    const sanitizeDirectives = getSanitizeDirectives(value)

    if (sanitizeDirectives.length > 0) {
      results.push({ key: prefix + name, directives: sanitizeDirectives })
    } else if (
      value.astNode.type.kind === 'NamedType' ||
      (value.astNode.type.kind === 'NonNullType' &&
        value.astNode.type.type.kind === 'NamedType')
    ) {
      const type =
        value.astNode.type.kind === 'NamedType'
          ? value.astNode.type.name.value
          : value.astNode.type.type.name.value
      results.push(
        ...getDirectiveInputs(schema, type, prefix + value.astNode.name.value)
      )
    }
  }
  return results
}

function getValue(key, object) {
  let value = object
  for (const part of key.split('.')) {
    value = value?.[part]
  }
  return value
}

function setValue(key, value, object) {
  let parent = object
  const parts = key.split('.')
  const lastKey = parts.pop()
  for (const part of parts) {
    parent = parent?.[part]
  }
  parent[lastKey] = value
}

function sanitizeValue({ value, set, directives }) {
  if (!value) {
    return
  }
  const sanitizeEmail = directives.includes('sanitizeEmail')

  if (sanitizeEmail) {
    if (!value.includes('@')) {
      throw new ApplicationError('invalid email', {
        code: 'invalidEmail'
      })
    }
    value = value.toLowerCase().trim()
    set(value)
  }
}
