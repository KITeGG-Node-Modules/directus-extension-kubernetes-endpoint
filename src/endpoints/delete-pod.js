import { getKubernetesClient } from '../lib/get-kubernetes-client.js'
import { servicesNamespace } from '../lib/config.js'
import { isDeploymentOwner, loadDeployment } from '../lib/resolve-deployment.js'
import { getDeploymentName, handleErrorResponse } from '../lib/util.js'
import { getOwnedPod } from '../lib/get-owned-pod.js'

export async function deleteDeploymentPod(ctx) {
  const { req, res, user } = ctx
  const { podName } = req.params
  if (!podName) {
    res.status(400)
    return { message: 'api_errors.pod_name_missing' }
  }
  const deployment = await loadDeployment(ctx)
  if (!deployment) {
    return { message: 'api_errors.not_found' }
  }
  if (!isDeploymentOwner(req, user, deployment)) {
    res.status(403)
    return { message: 'api_errors.forbidden' }
  }
  try {
    const statefulSetName = getDeploymentName(deployment.id)
    const pod = await getOwnedPod(statefulSetName, podName)
    if (!pod) {
      res.status(404)
      return { message: 'api_errors.not_found' }
    }
    const coreClient = getKubernetesClient(servicesNamespace)
    await coreClient.deleteNamespacedPod(podName, servicesNamespace)
    return { deleted: podName }
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}
