import { parse } from 'yaml'
import { COLLECTIONS } from './constants.js'
import { gpuProfileToResource } from './gpu-profiles.js'

/**
 * GPU demand of a deployment spec, keyed by Kubernetes resource name:
 * { 'nvidia.com/gpu': 2, ... }
 */
export function gpuDemandFromDeployment(data) {
  const replicas = typeof data?.replicas === 'number' ? data.replicas : 1
  return (data?.containers || []).reduce((p, c) => {
    if (!c.gpu || !c.gpu.length) return p
    if (!p[c.gpu]) p[c.gpu] = (c.gpuCount || 1) * replicas
    else p[c.gpu] += (c.gpuCount || 1) * replicas
    return p
  }, {})
}

/**
 * GPUs reserved for a deployment across all reservation rows, keyed by
 * Kubernetes resource name.
 */
export function reservedGpuProfiles(reservations) {
  return (reservations || []).reduce((p, reservation) => {
    for (const gpu of reservation?.gpus || []) {
      const resource = gpuProfileToResource(gpu)
      if (resource) p[resource] = (p[resource] ?? 0) + 1
    }
    return p
  }, {})
}

/**
 * Check that a deployment's GPU demand is covered by its reservations.
 * Deployments without GPU demand always pass.
 */
export async function checkReservation(
  req,
  services,
  deployment,
  deploymentData
) {
  const { ItemsService } = services
  const reservationsService = new ItemsService(COLLECTIONS.gpuReservations, {
    schema: req.schema,
    accountability: req.accountability,
  })
  const data = deploymentData ?? parse(deployment.data)
  const deploymentProfiles = gpuDemandFromDeployment(data)
  if (!Object.keys(deploymentProfiles).length) return true
  const reservations = await reservationsService.readByQuery({
    filter: { deployment: { _eq: deployment.id } },
  })
  if (!reservations || !reservations.length) return false
  const profiles = reservedGpuProfiles(reservations)
  let isInvalid = false
  for (const key in deploymentProfiles) {
    isInvalid =
      isInvalid || !profiles[key] || deploymentProfiles[key] > profiles[key]
  }
  return !isInvalid
}
