import { baseRequestHandler } from 'kitegg-directus-extension-common'
import { handleErrorResponse } from '../../lib/util.js'
import { removeDeployment } from '../../lib/operations/remove-deployment.js'

export function deleteDeployment(router, context) {
  router.delete(
    '/deployments/:id',
    baseRequestHandler(async (ctx) => {
      const { req, res, services } = ctx
      const { ItemsService } = services
      const deploymentsService = new ItemsService('k8s_deployments', {
        schema: req.schema,
        accountability: req.accountability,
      })
      const deploymentObject = await deploymentsService.readOne(req.params.id)
      if (!deploymentObject) {
        res.status(404)
        return { message: 'api_errors.not_found' }
      }
      try {
        const result = await removeDeployment(deploymentObject, res)
        res.send(result)
      } catch (err) {
        return handleErrorResponse(res, err)
      }
    }, context)
  )
}
