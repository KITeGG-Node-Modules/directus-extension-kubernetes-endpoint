import validate from 'validate.js'

export async function validateNamespace(namespace, id = undefined) {
  const validationErrors = validate(namespace, {
    name: {
      presence: true,
      type: 'string',
      format: {
        pattern:
          '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*',
        message:
          'of namespace must be a lowercase RFC1123 hostname (a-z,0-9,-,.)',
      },
    },
  })
  if (validationErrors?.length) return validationErrors
}
