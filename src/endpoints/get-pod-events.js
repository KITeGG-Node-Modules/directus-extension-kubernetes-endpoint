import { getPodEvents } from '../get-pod-events.js'
import { loadDeployment } from '../lib/resolve-deployment.js'
import { getDeploymentName, handleErrorResponse } from '../lib/util.js'
import { getOwnedPod } from '../lib/get-owned-pod.js'

export async function getDeploymentPodEvents(ctx) {
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
  try {
    const statefulSetName = getDeploymentName(deployment.id)
    const pod = await getOwnedPod(statefulSetName, podName)
    if (!pod) {
      res.status(404)
      return { message: 'api_errors.not_found' }
    }
    return await getPodEvents(podName)
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}
