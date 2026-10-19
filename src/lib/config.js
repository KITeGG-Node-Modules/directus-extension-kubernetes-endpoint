export const servicesNamespace = process.env.SERVICES_NAMESPACE || 'services'

// M2M field on the `deployments` collection listing users with rights on
// a deployment (junction rows expose the user as `directus_users_id`).
// Set it to an empty value to skip this ownership source.
export const deploymentAuthorsField =
  process.env.DEPLOYMENT_AUTHORS_FIELD ?? 'authors'

// Set ENFORCE_DEPLOYMENT_OWNERSHIP=false to disable deployment ownership checks
export const enforceDeploymentOwnership =
  process.env.ENFORCE_DEPLOYMENT_OWNERSHIP !== 'false'

// Storage class for volume claim templates
export const storageClassName = process.env.SERVICES_STORAGE_CLASS || 'longhorn'

// Deployment statuses that make a deployment PUBLICLY reachable (from the
// ingress path, on its declared service ports). Deployments in any other
// state (draft, restricted, unknown) can only be reached on their declared
// service ports by deployments of the same owners (user_created / authors).
// The Directus `status` field of the deployments collection decides; set to
// a comma-separated list to allow several public states.
export const deploymentPublicStatuses = (
  process.env.DEPLOYMENT_PUBLIC_STATUSES ?? 'published'
)
  .split(',')
  .map((status) => status.trim())
  .filter(Boolean)
