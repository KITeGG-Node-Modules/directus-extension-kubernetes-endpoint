import { createService } from '../create-service.js'
import { createStatefulSet } from '../create-stateful-set.js'
import { deleteUnreadyStatefulSetPods } from '../delete-unready-stateful-set-pods.js'
import { checkReservation } from '../lib/check-reservation.js'
import { makeService } from '../lib/make-service.js'
import { makeStatefulSet } from '../lib/make-stateful-set.js'
import {
  isDeploymentOwner,
  loadDeployment,
} from '../lib/resolve-deployment.js'
import {
  getDeploymentName,
  handleErrorResponse,
  parseDeploymentData,
} from '../lib/util.js'
import { validateDeployment } from '../lib/validate-deployment.js'
import { syncOwnerGroup } from '../sync-network-policies.js'

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
  // Isolation resources are created before the stateful set so a
  // deployment is never running without them (fail closed). If the
  // extension's account lacks the networkpolicies RBAC (k8s/rbac.yaml),
  // deploying fails with a 403. The whole owner group is synced: this
  // deployment's policy needs its peers, and the peers' policies must
  // start allowing this deployment (or stop allowing it after owner
  // changes).
  try {
    await syncOwnerGroup(services, req.schema, deployment)
  } catch (err) {
    return handleErrorResponse(res, err)
  }
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

  if (!created) {
    // The StatefulSet already existed: its pods must pick up the new
    // template. The controller's OrderedReady rolling update never rolls a
    // pod that never became Ready (CreateContainerConfigError,
    // CrashLoopBackOff, Pending), so a re-deploy of a failing deployment
    // would otherwise update the revision while the pod kept running the
    // broken configuration forever
    try {
      await deleteUnreadyStatefulSetPods(statefulSetName)
    } catch (err) {
      return handleErrorResponse(res, err)
    }
  }

  if (created) res.status(201)
  return deploymentData
}
