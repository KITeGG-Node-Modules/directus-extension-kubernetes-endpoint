import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { getDeploymentName, handleErrorResponse } from '../lib/util.js'
import { servicesNamespace } from '../lib/config.js'
import k8s from '@kubernetes/client-node'

export function deleteDeployment(router, context) {
  router.delete(
    '/deployments/:id',
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
        const appsClient = getKubernetesClient(servicesNamespace, k8s.AppsV1Api)
        const coreClient = getKubernetesClient(servicesNamespace)
        const { body: podsBody } = await coreClient.listNamespacedPod(
          servicesNamespace,
          undefined,
          undefined,
          undefined,
          undefined,
          `app=${statefulSetName}`
        )
        const { items: pods } = podsBody
        await appsClient.deleteNamespacedStatefulSet(
          statefulSetName,
          servicesNamespace,
          undefined,
          undefined,
          undefined,
          undefined,
          'Background'
        )
        for (const pod of pods) {
          for (const containerStatus of pod.status.containerStatuses) {
            const serviceName = `${statefulSetName}-${containerStatus.name}`
            await coreClient.deleteNamespacedService(
              serviceName,
              servicesNamespace,
              undefined,
              undefined,
              undefined,
              undefined,
              'Background'
            )
          }
        }
        const { body: volumeClaimsBody } =
          await coreClient.listNamespacedPersistentVolumeClaim(
            servicesNamespace,
            undefined,
            undefined,
            undefined,
            undefined,
            `app=${statefulSetName}`
          )
        const { items: volumeClaims } = volumeClaimsBody
        for (const claim of volumeClaims) {
          await coreClient.deleteNamespacedPersistentVolumeClaim(
            claim.metadata.name,
            servicesNamespace,
            undefined,
            undefined,
            undefined,
            undefined,
            'Background'
          )
        }
        return { deleted: deployment.id }
      } catch (err) {
        return handleErrorResponse(res, err)
      }
    }, context)
  )
}
