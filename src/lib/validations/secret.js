import validate from 'validate.js'

export function validateSecret(payload) {
  const validationErrors = validate(payload, {
    name: {
      type: 'string',
      format: {
        pattern:
          '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*',
        message: 'must be a lowercase RFC1123 hostname (a-z,0-9,-,.)',
      },
    },
    data: {
      type: 'string',
    },
  })
  if (validationErrors?.length) return validationErrors
}
