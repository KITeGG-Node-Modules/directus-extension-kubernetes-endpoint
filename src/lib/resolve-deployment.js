import { deploymentAuthorsField, deploymentPublicStatuses, enforceDeploymentOwnership } from './config.js'
import { COLLECTIONS } from './constants.js'

/**
 * Load the deployment referenced by :id.
 *
 * Returns the deployment item, or null after sending a 404 response
 * when it does not exist. The item is fetched in full (`*`) so the
 * handlers can use any of its fields; the ownership fields are
 * additionally requested as nested paths, because M2M fields are
 * otherwise returned as junction primary keys only.
 */
export async function loadDeployment(ctx) {
  const { req, res, services } = ctx
  const { ItemsService } = services
  const deploymentsService = new ItemsService(COLLECTIONS.deployments, {
    schema: req.schema,
    accountability: req.accountability,
  })
  const fields = ['*', 'user_created.id', 'user_updated.id']
  if (deploymentAuthorsField) {
    fields.push(`${deploymentAuthorsField}.directus_users_id.id`)
  }
  const deployment = await deploymentsService.readOne(req.params.id, { fields })
  if (!deployment) {
    res.status(404)
    return null
  }
  return deployment
}

/**
 * Normalize a value that may be a raw id or a related item into an id
 * string, or null when it holds no usable id.
 */
function toId(value) {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object' && value.id != null) return toId(value.id)
  return null
}

/**
 * Extract the user id from one entry of the authors list. Entries are
 * junction rows (`{ id, directus_users_id }`), nested user objects or
 * plain user ids.
 */
function authorIdFrom(entry) {
  if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
    return null
  }
  for (const key of ['directus_users_id', 'users_id', 'user']) {
    const id = toId(entry[key])
    if (id != null) return id
  }
  return toId(entry.id)
}

/**
 * Owner ids that determine which deployments may reach a restricted
 * deployment over the network: `user_created` and the `authors` M2M list.
 * (Deliberately not `user_updated` — who last modified an item is not the
 * same as who may access it.)
 */
export function deploymentOwnerIds(deployment) {
  const ownerIds = []
  const createdId = toId(deployment?.user_created)
  if (createdId != null) ownerIds.push(String(createdId))
  const authors = deployment?.[deploymentAuthorsField]
  if (authors != null) {
    for (const entry of Array.isArray(authors) ? authors : [authors]) {
      const id = authorIdFrom(entry) ?? toId(entry)
      if (id != null && !ownerIds.includes(String(id))) {
        ownerIds.push(String(id))
      }
    }
  }
  return ownerIds
}

/**
 * Whether the deployment is publicly reachable. Deployments whose Directus
 * `status` is not listed in DEPLOYMENT_PUBLIC_STATUSES (drafts, restricted
 * states and deployments without a status) can only be reached by
 * deployments of the same owners.
 */
export function isPublicDeployment(deployment) {
  return deploymentPublicStatuses.includes(String(deployment?.status ?? ''))
}

/**
 * Check that the requesting user owns the given deployment item.
 *
 * Admin users always have access. When enforcement is enabled, the
 * requesting user must match any of the deployment's ownership fields:
 * `user_created`, `user_updated`, or the `authors` M2M list of users
 * with rights on the deployment.
 * Returns false when no ownership field is populated, so deployments
 * without any owner can never be mutated by non-admin users.
 */
export function isDeploymentOwner(req, user, deployment) {
  if (req.accountability?.admin) return true
  if (!enforceDeploymentOwnership) return true
  const userId = user?.id ?? req.accountability?.user
  if (userId == null) return false
  const ownerIds = new Set()
  for (const field of ['user_created', 'user_updated']) {
    const id = toId(deployment?.[field])
    if (id != null) ownerIds.add(id)
  }
  const authors = deployment?.[deploymentAuthorsField]
  if (authors != null) {
    for (const entry of Array.isArray(authors) ? authors : [authors]) {
      const id = authorIdFrom(entry) ?? toId(entry)
      if (id != null) ownerIds.add(id)
    }
  }
  return ownerIds.has(String(userId))
}
