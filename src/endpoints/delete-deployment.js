import { deleteDeployment } from '../delete-deployment.js'
import { isDeploymentOwner, loadDeployment } from '../lib/resolve-deployment.js'
import { handleErrorResponse } from '../lib/util.js'
import { syncOwnerGroup } from '../sync-network-policies.js'

export async function deleteDeploymentRoute(ctx) {
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
    await deleteDeployment(deployment)
  } catch (err) {
    return handleErrorResponse(res, err)
  }
  // Regenerate the isolation resources of the remaining owner group so
  // their ingress rules no longer reference the deleted deployment (a
  // stale peer rule is harmless, but should not linger). Best effort: the
  // deletion itself succeeded.
  try {
    await syncOwnerGroup(services, req.schema, deployment)
  } catch (err) {
    console.error('network policy sync after delete failed:', err)
  }
  return { deleted: deployment.id }
}
