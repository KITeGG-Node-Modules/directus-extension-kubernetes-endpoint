import { putNamespace } from './put-namespace.js'
import { deleteNamespace } from './delete-namespace.js'

export function registerNamespaces(router, context) {
  putNamespace(router, context)
  deleteNamespace(router, context)
}
