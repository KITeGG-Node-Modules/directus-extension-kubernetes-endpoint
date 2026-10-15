import { parse } from 'yaml'
import { COLLECTIONS } from './constants.js'
import { gpuProfileToResource } from './gpu-profiles.js'

/**
 * GPU demand of a deployment spec, keyed by Kubernetes resource name:
 * { 'nvidia.com/gpu': 2, ... }
 *
 * The demand scales with the replica count: the given replica count when
 * one is passed (e.g. the scale target when checking a scale request),
 * otherwise the replica count from the deployment data, defaulting to 1.
 * Zero replicas mean no demand.
 */
export function gpuDemandFromDeployment(data, replicas = data?.replicas) {
  const count = typeof replicas === 'number' ? replicas : 1
  if (count <= 0) return {}
  return (data?.containers || []).reduce((p, c) => {
    if (!c.gpu || !c.gpu.length) return p
    if (!p[c.gpu]) p[c.gpu] = (c.gpuCount || 1) * count
    else p[c.gpu] += (c.gpuCount || 1) * count
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
 * The demand is scaled by the given replica count when provided, e.g. the
 * scale target when checking a scale request. Deployments without GPU
 * demand always pass.
 */
export async function checkReservation(
  req,
  services,
  deployment,
  deploymentData,
  options = {}
) {
  const { ItemsService } = services
  const reservationsService = new ItemsService(COLLECTIONS.gpuReservations, {
    schema: req.schema,
    accountability: req.accountability,
  })
  const data = deploymentData ?? parse(deployment.data)
  const deploymentProfiles = gpuDemandFromDeployment(data, options.replicas)
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
