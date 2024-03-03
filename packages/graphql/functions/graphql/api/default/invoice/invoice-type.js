const invoiceType = `
    type Mutation {
        invoice: InvoiceMutations
    }

    type InvoiceMutations {
      createPdf: String!
    }
`

export default invoiceType
