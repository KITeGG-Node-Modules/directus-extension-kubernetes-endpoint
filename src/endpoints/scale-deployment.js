import { getKubernetesClient } from '../lib/get-kubernetes-client.js'
import k8s from '@kubernetes/client-node'
import { checkReservation } from '../lib/check-reservation.js'
import { servicesNamespace } from '../lib/config.js'
import { isDeploymentOwner, loadDeployment } from '../lib/resolve-deployment.js'
import {
  getDeploymentName,
  handleErrorResponse,
  parseDeploymentData,
  parseScale,
} from '../lib/util.js'

export async function scaleDeployment(ctx) {
  const { req, res, user, services } = ctx
  const { scale } = req.query
  const deployment = await loadDeployment(ctx)
  if (!deployment) {
    return { message: 'api_errors.not_found' }
  }
  if (!isDeploymentOwner(req, user, deployment)) {
    res.status(403)
    return { message: 'api_errors.forbidden' }
  }
  try {
    const deploymentData = parseDeploymentData(deployment)
    const statefulSetName = getDeploymentName(deployment.id)
    const client = getKubernetesClient(servicesNamespace, k8s.AppsV1Api)
    if (typeof scale !== 'undefined') {
      // ?scale= must be an integer within the replica bounds
      const replicas = parseScale(scale)
      if (replicas === null) {
        res.status(400)
        return { message: 'api_errors.bad_request' }
      }
      // Scaling to zero frees resources, so it must always be possible:
      // otherwise a deployment whose GPU reservations no longer cover
      // its demand could not be scaled down at all
      if (replicas > 0) {
        const isValid = await checkReservation(
          req,
          services,
          deployment,
          deploymentData
        )
        if (!isValid) {
          res.status(400)
          return { message: 'api_errors.not_enough_resources' }
        }
      }
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
            path: '/spec',
            value: {
              replicas,
            },
          },
        ]
        const options = {
          headers: {
            'Content-type': k8s.PatchUtils.PATCH_FORMAT_JSON_PATCH,
          },
        }
        await client.patchNamespacedStatefulSetScale(
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
    }
    res.status(400)
    return { message: 'api_errors.bad_request' }
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}
