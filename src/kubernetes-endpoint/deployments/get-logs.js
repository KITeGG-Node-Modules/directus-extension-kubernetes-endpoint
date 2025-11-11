import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { ROUTE_PREFIX } from '../../lib/variables.js'
import { getNamespace, handleErrorResponse } from '../../lib/util/helpers.js'

export function getLogs(router, context) {
  router.get(
    `${ROUTE_PREFIX}/deployments/:id/logs/:podName`,
    baseRequestHandler(async (ctx) => {
      const { req, res, services } = ctx
      const { podName } = req.params
      if (!podName) {
        res.status(400)
        return { message: 'api_errors.pod_name_missing' }
      }
      const { ItemsService } = services
      const deploymentsService = new ItemsService('k8s_deployments', {
        schema: req.schema,
        accountability: req.accountability,
      })
      const deployment = await deploymentsService.readOne(req.params.id)
      if (!deployment) {
        res.status(404)
        return { message: 'api_errors.not_found' }
      }
      try {
        const deploymentNamespace = getNamespace(
          deployment.user_created,
          deployment.namespace
        )
        const coreClient = getKubernetesClient(deploymentNamespace)
        const sinceSeconds = req.query.sinceSeconds
          ? parseInt(req.query.sinceSeconds)
          : undefined
        const { body } = await coreClient.readNamespacedPodLog(
          podName,
          deploymentNamespace,
          req.query.container,
          false,
          undefined,
          undefined,
          undefined,
          !!req.query.previous,
          sinceSeconds,
          undefined,
          !!req.query.timestamps
        )
        res.setHeader('content-type', 'text/plain')
        return body || ''
      } catch (err) {
        return handleErrorResponse(res, err)
      }
    }, context)
  )
}
