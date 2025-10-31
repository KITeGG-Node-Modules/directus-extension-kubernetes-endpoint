import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { handleErrorResponse } from '../lib/util.js'
import k8s from '@kubernetes/client-node'

export function deleteDeployment(router, context) {
  router.delete(
    '/deployments/:id',
    baseRequestHandler(async (ctx) => {
      const { req, res, services } = ctx
      const { ItemsService } = services
      const deploymentsService = new ItemsService('k8s_deployments', {
        schema: req.schema,
        accountability: req.accountability,
      })
      const deploymentObject = await deploymentsService.readOne(req.params.id)
      if (!deploymentObject) {
        res.status(404)
        return { message: 'api_errors.not_found' }
      }
      try {
        const appsClient = getKubernetesClient(
          deploymentObject.namespace,
          k8s.AppsV1Api
        )
        await appsClient.deleteNamespacedDeployment(
          deploymentObject.name,
          deploymentObject.namespace,
          undefined,
          undefined,
          undefined,
          undefined,
          'Background'
        )
        return { deleted: deploymentObject.id }
      } catch (err) {
        return handleErrorResponse(res, err)
      }
    }, context)
  )
}
