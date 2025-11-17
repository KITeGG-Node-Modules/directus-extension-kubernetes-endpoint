import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { getNamespace, handleErrorResponse } from '../../lib/util/helpers.js'
import { ROUTE_PREFIX } from '../../lib/variables.js'
import k8s from '@kubernetes/client-node'

export function patchDeployment(router, context) {
  router.patch(
    `${ROUTE_PREFIX}/deployments/:id`,
    baseRequestHandler(async (ctx) => {
      const { req, res, services } = ctx
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
        const deploymentNamespace = getNamespace(deployment.namespace)
        const client = getKubernetesClient(deploymentNamespace, k8s.AppsV1Api)
        if (typeof scale !== 'undefined') {
          const { body: existing } = await client.listNamespacedDeployment(
            deploymentNamespace,
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
              deploymentNamespace,
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
