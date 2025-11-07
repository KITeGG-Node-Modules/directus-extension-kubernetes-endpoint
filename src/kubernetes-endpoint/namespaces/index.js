import { postNamespace } from './post-namespace.js'
import { deleteNamespace } from './delete-namespace.js'
import { listNamespaces } from './list-namespaces.js'

export function registerNamespaces(router, context) {
  listNamespaces(router, context)
  postNamespace(router, context)
  deleteNamespace(router, context)
}
