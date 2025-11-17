import validate from 'validate.js'

export async function validateService(service) {
  const validationErrors = validate(service, {
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
    port: {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
        greaterThan: 0,
      },
    },
    protocol: {
      type: 'string',
      inclusion: ['TCP', 'UDP'],
    },
  })
  if (validationErrors?.length) return validationErrors
}
