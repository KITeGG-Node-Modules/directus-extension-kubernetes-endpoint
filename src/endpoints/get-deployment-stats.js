import { getDeploymentStats } from '../get-deployment-stats.js'
import { loadDeployment } from '../lib/resolve-deployment.js'
import { handleErrorResponse } from '../lib/util.js'

/**
 * GET /kubernetes/deployments/:id/stats and
 * GET /kubernetes/deployments/:id/stats/:podName
 *
 * Read endpoint: ownership is enforced by loadDeployment (the Directus
 * accountability of the requesting user bounds the read), and the
 * pod-scoped variant only ever returns pods matched against the
 * deployment's StatefulSet label — pod names from other deployments
 * result in a 404, mirroring the logs/events endpoints.
 */
export async function getDeploymentStatsRoute(ctx) {
  const { res } = ctx
  const deployment = await loadDeployment(ctx)
  if (!deployment) {
    return { message: 'api_errors.not_found' }
  }
  const podName = ctx.req.params?.podName ?? null
  try {
    const stats = await getDeploymentStats(deployment, podName)
    if (!stats) {
      // A pod name that does not match the deployment's pods (foreign or
      // stale) — same contract as the pod-scoped logs/events endpoints
      res.status(404)
      return { message: 'api_errors.not_found' }
    }
    return stats
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}
