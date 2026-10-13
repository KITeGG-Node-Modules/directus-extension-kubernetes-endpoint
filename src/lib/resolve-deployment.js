import {
  deploymentOwnerField,
  enforceDeploymentOwnership,
} from './config.js'
import { COLLECTIONS } from './constants.js'

/**
 * Load the deployment referenced by :id.
 *
 * Returns the deployment item, or null after sending a 404 response
 * when it does not exist.
 */
export async function loadDeployment(ctx) {
  const { req, res, services } = ctx
  const { ItemsService } = services
  const deploymentsService = new ItemsService(COLLECTIONS.deployments, {
    schema: req.schema,
    accountability: req.accountability,
  })
  const deployment = await deploymentsService.readOne(req.params.id)
  if (!deployment) {
    res.status(404)
    return null
  }
  return deployment
}

/**
 * Check that the requesting user owns the given deployment item.
 *
 * Admin users always have access. When enforcement is enabled, the
 * deployment's owner field must match the requesting user's id.
 * Returns false when the owner field is missing, so deployments without
 * an owner can never be mutated by non-admin users.
 */
export function isDeploymentOwner(req, user, deployment) {
  if (req.accountability?.admin) return true
  if (!enforceDeploymentOwnership) return true
  const ownerId = deployment?.[deploymentOwnerField]
  if (ownerId == null) return false
  const userId = user?.id ?? req.accountability?.user
  return String(ownerId) === String(userId)
}
