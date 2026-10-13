export const servicesNamespace = process.env.SERVICES_NAMESPACE || 'services'

// M2M field on the `deployments` collection listing users with rights on
// a deployment (junction rows expose the user as `directus_users_id`).
// Set it to an empty value to skip this ownership source.
export const deploymentAuthorsField =
  process.env.DEPLOYMENT_AUTHORS_FIELD ?? 'authors'

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
