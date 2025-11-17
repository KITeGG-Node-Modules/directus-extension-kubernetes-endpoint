import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { handleErrorResponse, parseNamespace } from '../../lib/util/helpers.js'
import k8s from '@kubernetes/client-node'
import {
  LABEL_NAMESPACE,
  NAMESPACE_PREFIX,
  ROUTE_PREFIX,
} from '../../lib/variables.js'

export function listNamespaces(router, context) {
  router.get(
    `${ROUTE_PREFIX}/namespaces`,
    baseRequestHandler(async (ctx) => {
      const { res, user } = ctx
      try {
        const client = getKubernetesClient(undefined, k8s.CoreV1Api)
        const { body: namespaces } = await client.listNamespace(
          undefined,
          undefined,
          undefined,
          undefined,
          {
            [`${LABEL_NAMESPACE}/userId`]: user.id,
          }
        )
        return namespaces.items
          .filter((item) => item.metadata.name.startsWith(NAMESPACE_PREFIX))
          .map((item) => parseNamespace(item.metadata.name))
      } catch (err) {
        return handleErrorResponse(res, err)
      }
    }, context)
  )
}
