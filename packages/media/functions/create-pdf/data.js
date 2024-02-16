import { faker } from '@faker-js/faker/locale/en'

export default {
  subject: 'fake invoice',
  title: 'fake product invoice',
  company: {
    email: faker.internet.email(),
    name: faker.company.name(),
    phone: faker.phone.number(),
    domain: faker.internet.domainName(),
    url: faker.internet.url(),
    address: {
      street: faker.address.street(),
      zipCode: faker.address.zipCode(),
      city: faker.address.city()
    }
  },
  ...generateProducts()
}

function generateProducts() {
  const productCount = 10

  const products = [...Array.from({ length: productCount }).keys()].map(() => {
    const name = faker.commerce.product()
    const price = faker.finance.amount()
    const quantity = Math.max(1, Math.floor(Math.random() * 4))
    const total = (price * quantity).toFixed(2)
    return {
      name,
      price,
      quantity,
      total
    }
  })

  return {
    products,
    totalPriceExcludingVAT: products
      .map((x) => x.total)
      .reduce((a, b) => Number(a) + Number(b), 0)
      .toFixed(2)
  }
}
