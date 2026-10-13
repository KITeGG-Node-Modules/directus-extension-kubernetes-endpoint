import { parse } from 'yaml'
import { COLLECTIONS } from './constants.js'
import { gpuProfileToResource } from './gpu-profiles.js'

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
  const replicas = typeof data.replicas === 'number' ? data.replicas : 1
  const deploymentProfiles = (data.containers || []).reduce((p, c) => {
    if (!c.gpu || !c.gpu.length) return p
    if (!p[c.gpu]) p[c.gpu] = (c.gpuCount || 1) * replicas
    else p[c.gpu] += (c.gpuCount || 1) * replicas
    return p
  }, {})
  if (!Object.keys(deploymentProfiles).length) return true
  const reservations = await reservationsService.readByQuery({
    filter: { deployment: { _eq: deployment.id } },
  })
  const profiles = (reservations || []).reduce((p, reservation) => {
    for (const gpu of reservation.gpus || []) {
      const resource = gpuProfileToResource(gpu)
      if (resource) p[resource] = (p[resource] ?? 0) + 1
    }
    return p
  }, {})
  let isInvalid = false
  for (const key in deploymentProfiles) {
    isInvalid =
      isInvalid || !profiles[key] || deploymentProfiles[key] > profiles[key]
  }
  return !isInvalid
}
