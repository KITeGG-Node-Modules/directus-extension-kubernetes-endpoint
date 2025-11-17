import validate from 'validate.js'
import { getNamespace } from '../util/helpers.js'

export async function validateNamespace(namespace) {
  const { body: existing } = await client.listNamespace(
    undefined,
    undefined,
    undefined,
    undefined,
    `metadata.name=${getNamespace(namespace.name)}`
  )
  if (existing.items?.length === 1)
    return [{ message: 'api_errors.namespace_exists' }]

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
