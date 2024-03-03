import ApplicationError from './application-error.js'

export default function filterErrors(errors) {
  if (errors?.length) {
    return errors.map((error) => {
      return error instanceof ApplicationError
        ? error
        : new ApplicationError('Internal system error', {
            code: 'internalError'
          })
    })
  }
}
