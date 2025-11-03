import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { servicesNamespace } from '../../lib/config.js'
import { handleErrorResponse } from '../../lib/util.js'

export function deletePod(router, context) {
  router.delete(
    '/deployments/:id/pods/:podName',
    baseRequestHandler(async (ctx) => {
      const { req, res, services } = ctx
      const { podName } = req.params
      if (!podName) {
        res.status(400)
        return { message: 'api_errors.pod_name_missing' }
      }
      const { ItemsService } = services
      const deploymentsService = new ItemsService('deployments', {
        schema: req.schema,
        accountability: req.accountability,
      })
      const deployment = await deploymentsService.readOne(req.params.id)
      if (!deployment) {
        res.status(404)
        return { message: 'api_errors.not_found' }
      }
      try {
        const coreClient = getKubernetesClient(servicesNamespace)
        await coreClient.deleteNamespacedPod(podName, servicesNamespace)
        return { deleted: podName }
      } catch (err) {
        return handleErrorResponse(res, err)
      }
    }, context)
  )
}
