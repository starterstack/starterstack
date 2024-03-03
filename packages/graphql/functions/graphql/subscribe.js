/* eslint-disable unicorn/no-null, @typescript-eslint/require-await */
export default async function subscribe(_, { fireOnce }, __, ast) {
  const namespace = ast.fieldName

  const namespaceField = ast.fieldNodes.find(function findField(field) {
    return field.kind === 'Field' && field.name.value === namespace
  })

  const topics = namespaceField.selectionSet.selections
    .map(function mapTopic(selection) {
      if (selection.kind === 'Field') {
        if (
          selection.name?.kind === 'Name' &&
          selection.name?.value === '__typename'
        ) {
          return null
        }
        const topicName = `${namespace}:${selection.name.value}`
        const args = selection.arguments
          .map((argument) => {
            if (argument.kind === 'Argument') {
              const name = argument.name.value
              const value =
                argument.value.kind === 'Variable'
                  ? ast.variableValues[argument.value.name.value]
                  : argument.value.value
              return {
                name,
                value
              }
            } else {
              return null
            }
          })
          .filter(Boolean)

        return {
          topicName,
          args
        }
      } else {
        return null
      }
    })
    .filter(Boolean)

  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return {
            done: true,
            value: { topics, fireOnce }
          }
        }
      }
    }
  }
}
