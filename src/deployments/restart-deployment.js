import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { getDeploymentName, handleErrorResponse } from '../lib/util.js'
import { servicesNamespace } from '../lib/config.js'
import k8s from '@kubernetes/client-node'
import { DateTime } from 'luxon'

export function restartDeployment(router, context) {
  router.get(
    '/deployments/:id/hooks/restart',
    baseRequestHandler(async (ctx) => {
      const { req, res, user, services } = ctx
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
        const statefulSetName = getDeploymentName(user, deployment.id)
        const client = getKubernetesClient(servicesNamespace, k8s.AppsV1Api)
        const { body: existing } = await client.listNamespacedStatefulSet(
          servicesNamespace,
          undefined,
          undefined,
          undefined,
          `metadata.name=${statefulSetName}`
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
          await client.patchNamespacedStatefulSet(
            statefulSetName,
            servicesNamespace,
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
