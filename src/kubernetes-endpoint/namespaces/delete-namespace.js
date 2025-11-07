import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { getNamespace, handleErrorResponse } from '../../lib/util.js'
import k8s from '@kubernetes/client-node'
import { ROUTE_PREFIX } from '../../lib/config.js'

export function deleteNamespace(router, context) {
  router.delete(
    `${ROUTE_PREFIX}/namespaces/:namespace`,
    baseRequestHandler(async (ctx) => {
      const { req, res, user } = ctx
      const namespaceName = getNamespace(user.id, req.params.namespace)
      try {
        const client = getKubernetesClient(undefined, k8s.CoreV1Api)
        await client.deleteNamespace(namespaceName)
      } catch (err) {
        return handleErrorResponse(res, err)
      }

      return { deleted: req.params.namespace }
    }, context)
  )
}
