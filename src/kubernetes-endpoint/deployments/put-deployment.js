import { baseRequestHandler } from 'kitegg-directus-extension-common'
import { handleErrorResponse } from '../../lib/util.js'
import { validateDeployment } from '../../lib/validations/validate-deployment.js'
import { createOrReplaceDeployment } from '../../lib/operations/create-update-deployment.js'

export function putDeployment(router, context) {
  router.put(
    '/deployments/:id',
    baseRequestHandler(async (ctx) => {
      const { req, res, userGroups, services } = ctx
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

      const validationErrors = validateDeployment(deploymentObject, userGroups)
      if (validationErrors) {
        res.status(400)
        return validationErrors
      }
      try {
        await createOrReplaceDeployment(deploymentObject, res)
      } catch (err) {
        return handleErrorResponse(res, err)
      }

      return deploymentObject

      // res.status(404)
      // return { message: 'api_errors.not_found' }
    }, context)
  )
}
