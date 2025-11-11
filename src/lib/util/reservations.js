import { parse } from 'yaml'
import { GPU_PROFILE_MAPPING } from '../variables.js'

export async function checkReservation(req, services, deployment) {
  const { ItemsService } = services
  const reservationsService = new ItemsService('gpu_reservations', {
    schema: req.schema,
    accountability: req.accountability,
  })
  const data = parse(deployment.data)
  const deploymentProfiles = (data.containers || []).reduce(
    (profiles, container) => {
      if (!container.gpu || !container.gpu.length) return profiles
      if (!profiles[container.gpu])
        profiles[container.gpu] = container.gpuCount || 1
      else profiles[container.gpu] += container.gpuCount || 1
      return profiles
    },
    {}
  )
  if (!Object.keys(deploymentProfiles).length) return true
  const reservations = await reservationsService.readByQuery({
    filter: { k8s_deployment: { _eq: deployment.id } },
  })
  const reservation = reservations.shift()
  if (reservation) {
    const profiles = reservation.gpus.reduce((profile, container) => {
      const profileName = GPU_PROFILE_MAPPING[container]
      if (profileName) {
        if (profile[profileName]) profile[profileName] += 1
        else profile[profileName] = 1
      }
      return profile
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
