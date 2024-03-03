const directiveType = `
    directive @roles(
      required: [String!]!
    ) on OBJECT | FIELD_DEFINITION
    directive @sanitizeEmail on FIELD_DEFINITION | INPUT_FIELD_DEFINITION | ARGUMENT_DEFINITION
`

export default directiveType
