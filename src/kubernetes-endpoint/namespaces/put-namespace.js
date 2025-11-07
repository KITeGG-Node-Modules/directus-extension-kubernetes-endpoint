import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { getNamespace, handleErrorResponse } from '../../lib/util.js'
import k8s from '@kubernetes/client-node'
import { validateNamespace } from '../../lib/validations/namespace.js'
import { makeNamespace } from '../../lib/factories/namespace.js'
import { ROUTE_PREFIX } from '../../lib/config.js'

export function putNamespace(router, context) {
  router.put(
    `${ROUTE_PREFIX}/namespaces/:id`,
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

      const validationErrors = validateNamespace(namespaceObject)
      if (validationErrors) {
        res.status(400)
        return validationErrors
      }
      const namespaceName = getNamespace(user, namespaceObject.name)
      const namespace = makeNamespace(user, namespaceObject)
      try {
        const client = getKubernetesClient(undefined, k8s.CoreV1Api)
        const { body: existing } = await client.listNamespace(
          undefined,
          undefined,
          undefined,
          undefined, // `metadata.name=${namespaceName}`
          `llp.kitegg.de/objectId=${namespaceObject.id}`
        )
        let result
        if (existing.items.length === 1) {
          res.status(400)
          return { message: 'api_errors.namespace_exists' }
        } else {
          result = await client.createNamespace(namespace)
          res.status(201)
        }
      } catch (err) {
        return handleErrorResponse(res, err)
      }

      return namespaceObject
    }, context)
  )
}
