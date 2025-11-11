import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { getNamespace, handleErrorResponse } from '../../lib/util/helpers.js'
import { ROUTE_PREFIX } from '../../lib/variables.js'
import k8s from '@kubernetes/client-node'
import { DateTime } from 'luxon'

export function restartDeployment(router, context) {
  router.get(
    `${ROUTE_PREFIX}/deployments/:id/hooks/restart`,
    baseRequestHandler(async (ctx) => {
      const { req, res, services } = ctx
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
        const client = getKubernetesClient(deploymentNamespace, k8s.AppsV1Api)
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
              path: '/spec/template/metadata/annotations',
              value: {
                'llp.kitegg.de/restartedAt': DateTime.now().toISO(),
              },
            },
          ]
          const options = {
            headers: {
              'Content-type': k8s.PatchUtils.PATCH_FORMAT_JSON_PATCH,
            },
          }
          await client.patchNamespacedDeployment(
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
        }
        res.status(404)
        return { message: 'api_errors.not_found' }
      } catch (err) {
        return handleErrorResponse(res, err)
      }
    }, context)
  )
}
