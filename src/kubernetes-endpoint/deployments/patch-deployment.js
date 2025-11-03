import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { getDeploymentName, handleErrorResponse } from '../../lib/util.js'
import { servicesNamespace } from '../../lib/config.js'
import k8s from '@kubernetes/client-node'

export function patchDeployment(router, context) {
  router.patch(
    '/deployments/:id',
    baseRequestHandler(async (ctx) => {
      const { req, res, services, user } = ctx
      const { scale } = req.query
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
        const client = getKubernetesClient(deployment.namespace, k8s.AppsV1Api)
        if (typeof scale !== 'undefined') {
          const { body: existing } = await client.listNamespacedDeployment(
            deployment.namespace,
            undefined,
            undefined,
            undefined,
            `metadata.name=${deployment.name}`
          )
          if (existing.items.length === 1) {
            const patch = [
              {
                op: 'replace',
                path: '/spec',
                value: {
                  replicas: parseInt(scale),
                },
              },
            ]
            const options = {
              headers: {
                'Content-type': k8s.PatchUtils.PATCH_FORMAT_JSON_PATCH,
              },
            }
            await client.patchNamespacedDeploymentScale(
              deployment.name,
              deployment.namespace,
              patch,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              options
            )
            return { success: true }
          } else {
            res.status(404)
            return { message: 'api_errors.not_found' }
          }
        }
        res.status(400)
        return { message: 'api_errors.bad_request' }
      } catch (err) {
        return handleErrorResponse(res, err)
      }
    }, context)
  )
}
