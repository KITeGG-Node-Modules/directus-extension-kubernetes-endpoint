import { parse } from 'yaml'
import { createSecret } from '../create-secret.js'
import { makeSecret } from '../lib/make-secret.js'
import { isDeploymentOwner, loadDeployment } from '../lib/resolve-deployment.js'
import { getDeploymentName, handleErrorResponse } from '../lib/util.js'

// Kubernetes object keys are restricted to alphanumeric, '-', '_' and '.'
const KEY_PATTERN = /^[-._a-zA-Z0-9]+$/

export async function putDeploymentSecret(ctx) {
  const { req, res, user } = ctx
  const deployment = await loadDeployment(ctx)
  if (!deployment) {
    return { message: 'api_errors.not_found' }
  }
  if (!isDeploymentOwner(req, user, deployment)) {
    res.status(403)
    return { message: 'api_errors.forbidden' }
  }
  const statefulSetName = getDeploymentName(deployment.id)
  let secretData = {}
  try {
    if (typeof req.body?.data === 'string') {
      secretData = parse(req.body?.data)
    } else {
      secretData = req.body?.data
    }
    if (
      !secretData ||
      typeof secretData !== 'object' ||
      Array.isArray(secretData)
    ) {
      res.status(400)
      return { message: 'api_errors.bad_request' }
    }
    for (const key in secretData) {
      if (typeof secretData[key] !== 'string') {
        secretData[key] = secretData[key].toString()
      }
    }
  } catch (err) {
    res.status(400)
    return {
      errors: [{ data: err.message }],
    }
  }
  for (const key of Object.keys(secretData)) {
    if (!KEY_PATTERN.test(key)) {
      res.status(400)
      return { message: 'api_errors.bad_request' }
    }
  }
  const secret = makeSecret(statefulSetName, secretData)
  try {
    const { created } = await createSecret(secret, statefulSetName)
    if (created) res.status(201)
  } catch (err) {
    return handleErrorResponse(res, err)
  }
  return secretData
}
