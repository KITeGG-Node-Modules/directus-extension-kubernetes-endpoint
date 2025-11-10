import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { handleErrorResponse } from '../../lib/util.js'
import k8s from '@kubernetes/client-node'
import { ROUTE_PREFIX } from '../../lib/variables.js'

export function getDeployment(router, context) {
  router.get(
    `${ROUTE_PREFIX}/deployments/:id`,
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
        const coreClient = getKubernetesClient(deploymentObject.namespace)
        const { body: deployment } = await appsClient.readNamespacedDeployment(
          deploymentObject.name,
          deploymentObject.namespace
        )
        const { body: podsBody } = await coreClient.listNamespacedPod(
          deploymentObject.namespace,
          undefined,
          undefined,
          undefined,
          undefined,
          `app=${deploymentObject.name}`
        )
        const { items: pods } = podsBody
        const { body: volumeClaimsBody } =
          await coreClient.listNamespacedPersistentVolumeClaim(
            deploymentObject.namespace,
            undefined,
            undefined,
            undefined,
            undefined,
            `app=${deploymentObject.name}`
          )
        const { items: volumeClaims } = volumeClaimsBody
        return {
          replicas: deployment.status.replicas,
          currentReplicas: deployment.status.currentReplicas,
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
