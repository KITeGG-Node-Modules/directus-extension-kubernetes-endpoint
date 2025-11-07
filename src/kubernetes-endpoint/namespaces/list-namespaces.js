import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import {
  getNamespace,
  handleErrorResponse,
  parseNamespace,
} from '../../lib/util.js'
import k8s from '@kubernetes/client-node'
import { ROUTE_PREFIX } from '../../lib/config.js'

export function listNamespaces(router, context) {
  router.get(
    `${ROUTE_PREFIX}/namespaces`,
    baseRequestHandler(async (ctx) => {
      const { res, user } = ctx
      try {
        const client = getKubernetesClient(undefined, k8s.CoreV1Api)
        const { body: namespaces } = await client.listNamespace()
        return namespaces.items
          .filter((item) =>
            item.metadata.name.startsWith(getNamespace(user.id, ''))
          )
          .map((item) => parseNamespace(item.metadata.name))
      } catch (err) {
        return handleErrorResponse(res, err)
      }
    }, context)
  )
}
