import validate from 'validate.js'

export function validateVolume(payload) {
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
    size: {
      type: 'string',
      format: {
        pattern: '^\\d{1,3}(?:Mi|Gi){1}$',
        message: 'must be one to three digits followed by Mi or Gi',
      },
    },
    mountType: {
      type: 'string',
      inclusion: ['ReadWriteOnce', 'ReadWriteMany'],
    },
  })
  if (validationErrors?.length) return validationErrors
}
