import { baseRequestHandler } from 'kitegg-directus-extension-common'
import { handleErrorResponse } from '../lib/util.js'

export function getDeployment(router, context) {
  router.get(
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
        const { body: statefulSet } =
          await appsClient.readNamespacedStatefulSet(
            statefulSetName,
            servicesNamespace
          )
        const { body: podsBody } = await coreClient.listNamespacedPod(
          servicesNamespace,
          undefined,
          undefined,
          undefined,
          undefined,
          `app=${statefulSetName}`
        )
        const { items: pods } = podsBody
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
        return {
          replicas: statefulSet.status.replicas,
          currentReplicas: statefulSet.status.currentReplicas,
          pods: (pods || []).map((pod) => {
            let { containerStatuses, initContainerStatuses } = pod.status || {}
            containerStatuses = Array.isArray(containerStatuses)
              ? containerStatuses
              : []
            initContainerStatuses = Array.isArray(initContainerStatuses)
              ? initContainerStatuses
              : []
            return {
              name: pod.metadata.name,
              phase: pod.status?.phase,
              containers: containerStatuses.map((container) => {
                return {
                  name: container.name,
                  ready: container.ready,
                  started: container.started,
                }
              }),
              initContainers: initContainerStatuses.map((container) => {
                return {
                  name: container.name,
                  ready: container.ready,
                  started: container.started,
                }
              }),
            }
          }),
          volumes: (volumeClaims || []).map((vc) => {
            return {
              name: vc.metadata.name,
              phase: vc.status?.phase,
              capacity: vc.status?.capacity?.storage,
              type: (vc.spec?.accessModes || []).find((e) =>
                e.startsWith('ReadWrite')
              ),
            }
          }),
        }
      } catch (err) {
        return handleErrorResponse(res, err)
      }
    }, context)
  )
}
