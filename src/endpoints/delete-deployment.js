import { deleteDeployment } from '../delete-deployment.js'
import { isDeploymentOwner, loadDeployment } from '../lib/resolve-deployment.js'
import { handleErrorResponse } from '../lib/util.js'

export async function deleteDeploymentRoute(ctx) {
  const { req, res, user } = ctx
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
  // The deleted deployment's own NetworkPolicy is removed by
  // deleteDeployment (by label selector); no other policy references it.
  return { deleted: deployment.id }
}
