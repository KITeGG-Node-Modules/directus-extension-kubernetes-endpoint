import { getKubernetesClient } from 'kitegg-directus-extension-common'
import { servicesNamespace } from '../lib/config.js'
import { loadDeployment } from '../lib/resolve-deployment.js'
import { getDeploymentName, handleErrorResponse } from '../lib/util.js'

export async function getDeploymentConfig(ctx) {
  const { res, user } = ctx
  const deployment = await loadDeployment(ctx)
  if (!deployment) {
    return { message: 'api_errors.not_found' }
  }
  try {
    const statefulSetName = getDeploymentName(deployment.id)
    const coreClient = getKubernetesClient(servicesNamespace)
    const configMap = await coreClient.readNamespacedConfigMap(
      statefulSetName,
      servicesNamespace
    )
    return { data: configMap.body.data }
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}
