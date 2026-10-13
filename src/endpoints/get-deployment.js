import { getDeploymentInfo } from '../get-deployment-info.js'
import { loadDeployment } from '../lib/resolve-deployment.js'
import { handleErrorResponse } from '../lib/util.js'

export async function getDeployment(ctx) {
  const { res } = ctx
  const deployment = await loadDeployment(ctx)
  if (!deployment) {
    return { message: 'api_errors.not_found' }
  }
  try {
    return await getDeploymentInfo(deployment)
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}
