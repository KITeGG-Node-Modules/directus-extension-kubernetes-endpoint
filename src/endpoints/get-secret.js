import { getKubernetesClient } from 'kitegg-directus-extension-common'
import { servicesNamespace } from '../lib/config.js'
import { loadDeployment } from '../lib/resolve-deployment.js'
import { getDeploymentName, handleErrorResponse } from '../lib/util.js'

export async function getDeploymentSecret(ctx) {
  const { res } = ctx
  const deployment = await loadDeployment(ctx)
  if (!deployment) {
    return { message: 'api_errors.not_found' }
  }
  try {
    const statefulSetName = getDeploymentName(deployment.id)
    const coreClient = getKubernetesClient(servicesNamespace)
    const secret = await coreClient.readNamespacedSecret(
      statefulSetName,
      servicesNamespace
    )
    const secretData = secret.body.data
    for (const key in secretData) {
      const buffer = Buffer.from(secretData[key], 'base64')
      secretData[key] = buffer.toString()
    }
    return { data: secretData }
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}
