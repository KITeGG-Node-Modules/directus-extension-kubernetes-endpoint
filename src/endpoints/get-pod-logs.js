import { getKubernetesClient } from 'kitegg-directus-extension-common'
import { servicesNamespace } from '../lib/config.js'
import { loadDeployment } from '../lib/resolve-deployment.js'
import { getDeploymentName, handleErrorResponse } from '../lib/util.js'
import { getOwnedPod } from '../lib/get-owned-pod.js'

export async function getPodLogs(ctx) {
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
    const coreClient = getKubernetesClient(servicesNamespace)
    let sinceSeconds
    if (req.query.sinceSeconds != null && req.query.sinceSeconds !== '') {
      sinceSeconds = parseInt(req.query.sinceSeconds, 10)
      if (Number.isNaN(sinceSeconds) || sinceSeconds <= 0) {
        res.status(400)
        return { message: 'api_errors.bad_request' }
      }
    }
    const { body } = await coreClient.readNamespacedPodLog(
      podName,
      servicesNamespace,
      req.query.container,
      false,
      undefined,
      undefined,
      undefined,
      !!req.query.previous,
      sinceSeconds,
      undefined,
      !!req.query.timestamps
    )
    res.setHeader('content-type', 'text/plain')
    return body || ''
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}
