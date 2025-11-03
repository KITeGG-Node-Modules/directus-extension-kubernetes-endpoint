import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { getDeploymentName, handleErrorResponse } from '../../lib/util.js'
import { servicesNamespace } from '../../lib/config.js'

export function getSecret(router, context) {
  router.get(
    '/deployments/:id/secret',
    baseRequestHandler(async (ctx) => {
      const { req, res, services, user } = ctx
      const { ItemsService } = services
      const deploymentsService = new ItemsService('deployments', {
        schema: req.schema,
        accountability: req.accountability,
      })
      const deployment = await deploymentsService.readOne(req.params.id)
      if (!deployment) {
        res.status(404)
        return { message: 'api_errors.not_found' }
      }
      try {
        const statefulSetName = getDeploymentName(user, deployment.id)
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
    }, context)
  )
}
