import { getDeploymentStatsHistory } from '../get-deployment-stats-history.js'
import { loadDeployment } from '../lib/resolve-deployment.js'
import { handleErrorResponse } from '../lib/util.js'
import { parseDuration } from '../get-deployment-stats-history.js'

/**
 * GET /kubernetes/deployments/:id/stats/history?range=1h&step=5m[&pod=…]
 *
 * Time series of the deployment's container resource usage and volume
 * usage, queried from Prometheus. Read endpoint: ownership is enforced
 * by loadDeployment (Directus accountability bounds the read); the
 * optional pod parameter only ever narrows to pods of the deployment's
 * StatefulSet.
 */
export async function getDeploymentStatsHistoryRoute(ctx) {
  const { req, res } = ctx
  const deployment = await loadDeployment(ctx)
  if (!deployment) {
    return { message: 'api_errors.not_found' }
  }
  try {
    const history = await getDeploymentStatsHistory(deployment, {
      rangeSeconds: parseDuration(req.query.range ?? '1h'),
      stepSeconds: req.query.step ? parseDuration(req.query.step) : null,
      podName: req.query.pod ?? null,
    })
    return history
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}
