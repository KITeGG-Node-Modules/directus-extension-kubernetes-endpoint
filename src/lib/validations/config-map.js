import validate from 'validate.js'

export function validateConfigMap(payload) {
  const validationErrors = validate(payload, {
    name: {
      type: 'string',
      format: {
        pattern:
          '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*',
        message: 'must be a lowercase RFC1123 hostname (a-z,0-9,-,.)',
      },
    },
    namespace: {
      type: 'string',
      format: {
        pattern:
          '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*',
        message: 'must be a lowercase RFC1123 hostname (a-z,0-9,-,.)',
      },
    },
  })
  if (validationErrors?.length) return validationErrors
}
