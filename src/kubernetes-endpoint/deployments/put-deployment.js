import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { getDeploymentName, handleErrorResponse } from '../../lib/util.js'
import { parse } from 'yaml'
import { validateDeployment } from '../../lib/validations/validate-deployment.js'
import { servicesNamespace } from '../../lib/config.js'
import k8s from '@kubernetes/client-node'
import { makeDeployment } from '../../lib/factories/make-deployment.js'

export async function createOrReplaceDeployment() {
  const client = getKubernetesClient(undefined, k8s.AppsV1Api)
  const { body: existing } = await client.listNamespacedDeployment(
    deploymentObject.namespace,
    undefined,
    undefined,
    undefined,
    `metadata.name=${deploymentObject.name}`
  )
  let result
  if (existing.items.length === 1) {
    result = await client.replaceNamespacedDeployment(
      deploymentObject.name,
      deploymentObject.namespace,
      deployment
    )
  } else {
    result = await client.createNamespacedDeployment(
      deploymentObject.namespace,
      deployment
    )
    res.status(201)
  }
}

export function putDeployment(router, context) {
  router.put(
    '/deployments/:id',
    baseRequestHandler(async (ctx) => {
      const { req, res, user, userGroups, services } = ctx
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
      const deployment = makeDeployment(deploymentObject)
      try {
        createOrReplaceDeployment(deployment)
      } catch (err) {
        return handleErrorResponse(res, err)
      }

      return deploymentObject

      // res.status(404)
      // return { message: 'api_errors.not_found' }
    }, context)
  )
}
