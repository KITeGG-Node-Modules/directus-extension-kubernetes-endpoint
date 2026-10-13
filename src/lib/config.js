export const servicesNamespace = process.env.SERVICES_NAMESPACE || 'services'

// Field on the `deployments` collection referencing the owning user
export const deploymentOwnerField =
  process.env.DEPLOYMENT_OWNER_FIELD || 'user'

// Set ENFORCE_DEPLOYMENT_OWNERSHIP=false to disable deployment ownership checks
export const enforceDeploymentOwnership =
  process.env.ENFORCE_DEPLOYMENT_OWNERSHIP !== 'false'
