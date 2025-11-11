import { parse } from 'yaml'

const gpuProfileMapping = {
  'gpu-l': 'nvidia.com/gpu',
  'gpu-m': 'nvidia.com/mig-3g.40gb',
  'gpu-s': 'nvidia.com/mig-2g.20gb',
  'gpu-xs': 'nvidia.com/mig-1g.10gb',
}

export async function checkReservation(req, services, deployment) {
  const { ItemsService } = services
  const reservationsService = new ItemsService('gpu_reservations', {
    schema: req.schema,
    accountability: req.accountability,
  })
  const data = parse(deployment.data)
  const deploymentProfiles = (data.containers || []).reduce((p, c) => {
    if (!c.gpu || !c.gpu.length) return p
    if (!p[c.gpu]) p[c.gpu] = c.gpuCount || 1
    else p[c.gpu] += c.gpuCount || 1
    return p
  }, {})
  if (!Object.keys(deploymentProfiles).length) return true
  const reservations = await reservationsService.readByQuery({
    filter: { deployment: { _eq: deployment.id } },
  })
  const reservation = reservations.shift()
  if (reservation) {
    const profiles = reservation.gpus.reduce((p, c) => {
      const pStr = gpuProfileMapping[c]
      if (pStr) {
        if (p[pStr]) p[pStr] += 1
        else p[pStr] = 1
      }
      return p
    }, {})
    let isInvalid = false
    for (const key in deploymentProfiles) {
      isInvalid =
        isInvalid || !profiles[key] || deploymentProfiles[key] > profiles[key]
    }
    return !isInvalid
  } else {
    return false
  }
}
