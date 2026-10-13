import {
  deploymentOwnerField,
  enforceDeploymentOwnership,
} from './config.js'

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
