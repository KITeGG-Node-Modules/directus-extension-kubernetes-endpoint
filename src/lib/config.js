import { DEFAULT_IMAGE_REGISTRIES } from './constants.js'

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

// Registries user containers may pull images from. Bare image names
// ('pytorch/pytorch') imply docker.io. Comma-separated env override
// replaces the default; set IMAGE_REGISTRY_ALLOWLIST='*' to disable the
// restriction entirely.
export const imageRegistryAllowlist = (() => {
  const raw = process.env.IMAGE_REGISTRY_ALLOWLIST
  if (raw == null) return DEFAULT_IMAGE_REGISTRIES
  const registries = raw
    .split(',')
    .map((registry) => registry.trim().toLowerCase())
    .filter(Boolean)
  return registries.includes('*') ? null : registries
})()
