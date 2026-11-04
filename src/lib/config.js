import {
  DEFAULT_IMAGE_REGISTRIES,
  DEFAULT_VOLUME_ACCESS_MODES,
} from './constants.js'

export const servicesNamespace = process.env.SERVICES_NAMESPACE || 'services'

// JupyterHub user notebooks run here. Their GPU profiles are unlocked by
// gpu_reservations (jupyterhub-profiles-endpoint) and enforced by the
// reservations-watcher, so their consumption belongs in the capacity
// display alongside the services namespace.
export const jupyterhubNamespace =
  process.env.JUPYTERHUB_NAMESPACE || 'jupyterhub'

// Namespaces whose GPU consumption the capacity endpoint reports.
export const countedNamespaces = [servicesNamespace, jupyterhubNamespace]

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

// Access modes user volume claims may request — the configured storage
// class must actually provision them, otherwise claims stay Pending
// forever. Comma-separated env override replaces the default;
// ALLOWED_VOLUME_ACCESS_MODES='*' allows any canonical access mode.
export const allowedVolumeAccessModes = (() => {
  const raw = process.env.ALLOWED_VOLUME_ACCESS_MODES
  if (raw == null) return DEFAULT_VOLUME_ACCESS_MODES
  const modes = raw
    .split(',')
    .map((mode) => mode.trim())
    .filter(Boolean)
  return modes.includes('*') ? null : modes
})()

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

// Namespace the monitoring stack (Prometheus) runs in — the stats
// history endpoint queries its HTTP API for time series
export const prometheusNamespace =
  process.env.PROMETHEUS_NAMESPACE || 'prometheus'

// Base URL of the Prometheus HTTP API for the deployment stats history
// endpoint. Defaults to the headless `prometheus-operated` service the
// Prometheus Operator always creates next to the Prometheus CR; set
// PROMETHEUS_URL='' to disable the history endpoint entirely.
export const prometheusUrl =
  process.env.PROMETHEUS_URL ??
  `http://prometheus-operated.${prometheusNamespace}.svc:9090`
