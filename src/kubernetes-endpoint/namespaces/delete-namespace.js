import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { getNamespace, handleErrorResponse } from '../../lib/util.js'
import k8s from '@kubernetes/client-node'

export function deleteNamespace(router, context) {
  router.delete(
    '/namespaces/:id',
    baseRequestHandler(async (ctx) => {
      const { req, res, user, services } = ctx
      const { ItemsService } = services
      const namespacesService = new ItemsService('k8s_namespaces', {
        schema: req.schema,
        accountability: req.accountability,
      })
      const namespaceObject = await namespacesService.readOne(req.params.id)
      if (!namespaceObject) {
        res.status(404)
        return { message: 'api_errors.not_found' }
      }

      const namespaceName = getNamespace(user, namespaceObject.name)
      try {
        const client = getKubernetesClient(undefined, k8s.CoreV1Api)
        await client.deleteNamespace(namespaceName)
      } catch (err) {
        return handleErrorResponse(res, err)
      }

      return { deleted: namespaceObject.id }
    }, context)
  )
}
