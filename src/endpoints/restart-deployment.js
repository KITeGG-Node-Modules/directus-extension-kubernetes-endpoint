import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { checkReservation } from '../lib/check-reservation.js'
import { servicesNamespace } from '../lib/config.js'
import { RESTART_ANNOTATION_KEY } from '../lib/constants.js'
import { isDeploymentOwner, loadDeployment } from '../lib/resolve-deployment.js'
import {
  getDeploymentName,
  handleErrorResponse,
  parseDeploymentData,
} from '../lib/util.js'

export async function restartDeployment(ctx) {
  const { req, res, user, services } = ctx
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
    const statefulSetName = getDeploymentName(deployment.id)
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
            [RESTART_ANNOTATION_KEY]: new Date().toISOString(),
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
}
