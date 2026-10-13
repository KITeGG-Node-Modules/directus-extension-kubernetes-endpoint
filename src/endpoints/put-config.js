import { parse } from 'yaml'
import { createConfigMap } from '../create-config-map.js'
import { makeConfigMap } from '../lib/make-config-map.js'
import { isDeploymentOwner, loadDeployment } from '../lib/resolve-deployment.js'
import { getDeploymentName, handleErrorResponse } from '../lib/util.js'

// Kubernetes object keys are restricted to alphanumeric, '-', '_' and '.'
const KEY_PATTERN = /^[-._a-zA-Z0-9]+$/

export async function putDeploymentConfig(ctx) {
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
  let configMapData = {}
  try {
    if (typeof req.body?.data === 'string') {
      configMapData = parse(req.body?.data)
    } else {
      configMapData = req.body?.data
    }
    if (
      !configMapData ||
      typeof configMapData !== 'object' ||
      Array.isArray(configMapData)
    ) {
      res.status(400)
      return { message: 'api_errors.bad_request' }
    }
    for (const key in configMapData) {
      if (typeof configMapData[key] !== 'string') {
        configMapData[key] = configMapData[key].toString()
      }
    }
  } catch (err) {
    res.status(400)
    return {
      errors: [{ data: err.message }],
    }
  }
  for (const key of Object.keys(configMapData)) {
    if (!KEY_PATTERN.test(key)) {
      res.status(400)
      return { message: 'api_errors.bad_request' }
    }
  }
  if (Object.keys(configMapData).length) {
    const configMap = makeConfigMap(statefulSetName, configMapData)
    try {
      const { created } = await createConfigMap(configMap, statefulSetName)
      if (created) res.status(201)
    } catch (err) {
      return handleErrorResponse(res, err)
    }

    return configMapData
  }
  res.status(400)
  return { message: 'api_errors.bad_request' }
}
