// @ts-check
const applicationErrorType = Symbol.for('ApplicationError')

export default class ApplicationError extends Error {
  /**
   * @param {string} message
   * @param {{
   *   code: string,
   *   id?: string | undefined
   * } | undefined} options
   * @param {any} extendedMessage
   */
  constructor(
    message,
    { code = 'unknown', id } = { code: 'unknown' },
    /* eslint-disable unicorn/no-null */ extendedMessage = null
  ) {
    super(message)
    this.extensions = {
      [applicationErrorType]: true,
      code,
      id,
      extendedMessage
    }
    // @ts-ignore
    Error.captureStackTrace(this, ApplicationError)
  }

  /**
   * @returns {{
   *   message: string,
   *   extensions: {
   *     code: string,
   *     id?: string | undefined
   *     extendedMessage?: any
   *   }
   * }}
   */
  toJSON() {
    const { code, id, extendedMessage } = this.extensions
    return {
      message: this.message,
      extensions: {
        code,
        id,
        extendedMessage
      }
    }
  }

  /**
   * @param {any} error
   * @returns {Boolean}
   */
  static [Symbol.hasInstance](error) {
    return (
      error?.name === 'ApplicationError' ||
      error?.extensions?.[applicationErrorType]
    )
  }
}
