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
import { validateNamespace } from '../../lib/validations/namespace.js'
import { makeNamespace } from '../../lib/factories/namespace.js'
import { ROUTE_PREFIX } from '../../lib/variables.js'

export function postNamespace(router, context) {
  router.post(
    `${ROUTE_PREFIX}/namespaces`,
    baseRequestHandler(async (ctx) => {
      const { req, res, user } = ctx
      const validationErrors = validateNamespace(req.body)
      if (validationErrors) {
        res.status(400)
        return validationErrors
      }
      const namespaceObject = {
        name: getNamespace(user.id, req.body.name),
      }
      const namespace = makeNamespace(namespaceObject)
      try {
        const client = getKubernetesClient(undefined, k8s.CoreV1Api)
        await client.createNamespace(namespace)
        res.status(201)
      } catch (err) {
        return handleErrorResponse(res, err)
      }

      return parseNamespace(namespaceObject.name)
    }, context)
  )
}
