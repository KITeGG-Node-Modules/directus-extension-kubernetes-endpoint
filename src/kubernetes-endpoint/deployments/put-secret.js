import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { getDeploymentName, handleErrorResponse } from '../../lib/util.js'
import { parse } from 'yaml'
import { makeSecret } from '../../lib/factories/make-secret.js'
import { servicesNamespace } from '../../lib/config.js'

export function putSecret(router, context) {
  router.put(
    '/deployments/:id/secret',
    baseRequestHandler(async (ctx) => {
      const { req, res, user, services } = ctx
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
      const statefulSetName = getDeploymentName(user, deployment.id)
      let secretData = {}
      try {
        if (typeof req.body?.data === 'string') {
          secretData = parse(req.body?.data)
        } else {
          secretData = req.body?.data
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
      const secret = makeSecret(statefulSetName, secretData)
      try {
        const client = getKubernetesClient(servicesNamespace)
        const { body: existing } = await client.listNamespacedSecret(
          servicesNamespace,
          undefined,
          undefined,
          undefined,
          `metadata.name=${statefulSetName}`
        )
        if (existing.items.length === 1) {
          await client.replaceNamespacedSecret(
            statefulSetName,
            servicesNamespace,
            secret
          )
        } else {
          await client.createNamespacedSecret(servicesNamespace, secret)
          res.status(201)
        }
      } catch (err) {
        return handleErrorResponse(res, err)
      }
      return secretData
    }, context)
  )
}
