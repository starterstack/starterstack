import process from 'node:process'

export const { DYNAMODB_STACK_TABLE } = process.env.IS_OFFLINE
  ? { DYNAMODB_STACK_TABLE: 'dynamodbStackTable' }
  : process.env
