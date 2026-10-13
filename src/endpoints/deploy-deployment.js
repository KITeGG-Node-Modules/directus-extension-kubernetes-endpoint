import { createService } from '../create-service.js'
import { createStatefulSet } from '../create-stateful-set.js'
import { checkReservation } from '../lib/check-reservation.js'
import { makeService } from '../lib/make-service.js'
import { makeStatefulSet } from '../lib/make-stateful-set.js'
import { isDeploymentOwner, loadDeployment } from '../lib/resolve-deployment.js'
import {
  getDeploymentName,
  handleErrorResponse,
  parseDeploymentData,
} from '../lib/util.js'
import { validateDeployment } from '../lib/validate-deployment.js'

export async function deployDeployment(ctx) {
  const { req, res, user, userGroups, services } = ctx
  const deployment = await loadDeployment(ctx)
  if (!deployment) {
    return { message: 'api_errors.not_found' }
  }
  if (!isDeploymentOwner(req, user, deployment)) {
    res.status(403)
    return { message: 'api_errors.forbidden' }
  }
  const statefulSetName = getDeploymentName(deployment.id)
  let deploymentData
  try {
    deploymentData = parseDeploymentData(deployment)
  } catch (err) {
    return handleErrorResponse(res, err)
  }
  if (!deploymentData) {
    res.status(400)
    return { message: 'api_errors.bad_request' }
  }
  const isValid = await checkReservation(
    req,
    services,
    deployment,
    deploymentData
  )
  if (!isValid) {
    res.status(400)
    return { message: 'api_errors.not_enough_resources' }
  }
  const validationErrors = validateDeployment(deploymentData, userGroups)
  if (validationErrors) {
    res.status(400)
    return validationErrors
  }
  const { statefulSet, servicePayloads } = makeStatefulSet(
    statefulSetName,
    deploymentData
  )
  let created = false
  try {
    const statefulSetResult = await createStatefulSet(
      statefulSet,
      statefulSetName
    )
    created = statefulSetResult.created
  } catch (err) {
    return handleErrorResponse(res, err)
  }

  for (const payload of servicePayloads) {
    const serviceName = `${statefulSetName}-${payload.name}`
    const service = makeService(statefulSetName, serviceName, payload.ports)
    try {
      const serviceResult = await createService(service, serviceName)
      created = created || serviceResult.created
    } catch (err) {
      return handleErrorResponse(res, err)
    }
  }

  if (created) res.status(201)
  return deploymentData
}
