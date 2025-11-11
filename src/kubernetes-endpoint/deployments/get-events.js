import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { getNamespace, handleErrorResponse } from '../../lib/util/helpers.js'
import { ROUTE_PREFIX } from '../../lib/variables.js'
import k8s from '@kubernetes/client-node'

export function getEvents(router, context) {
  router.get(
    `${ROUTE_PREFIX}/deployments/:id/events/:podName`,
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
        const eventsClient = getKubernetesClient(
          deploymentNamespace,
          k8s.EventsV1Api
        )
        // const labelSelector = `statefulset.kubernetes.io/pod-name=${podName}`
        const fieldSelector = `regarding.name=${podName}`
        const { body } = await eventsClient.listNamespacedEvent(
          deploymentNamespace,
          undefined,
          undefined,
          undefined,
          fieldSelector
          // labelSelector
        )
        const { items } = body
        return (items || []).map((item) => {
          return {
            creationTimestamp: item.metadata.creationTimestamp,
            note: item.note,
            reason: item.reason,
            type: item.type,
          }
        })
      } catch (err) {
        return handleErrorResponse(res, err)
      }
    }, context)
  )
}
