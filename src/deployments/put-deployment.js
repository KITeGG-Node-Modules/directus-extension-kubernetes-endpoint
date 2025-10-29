import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { getDeploymentName, handleErrorResponse } from '../lib/util.js'
import { parse } from 'yaml'
import { validateDeployment } from '../lib/validate-deployment.js'
import { makeStatefulSet } from '../lib/make-stateful-set.js'
import { makeService } from '../lib/make-service.js'
import { servicesNamespace } from '../lib/config.js'
import k8s from '@kubernetes/client-node'

export function putDeployment(router, context) {
  router.put(
    '/deployments/:id',
    baseRequestHandler(async (ctx) => {
      const { req, res, user, userGroups, services } = ctx
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
      let deploymentData
      try {
        deploymentData = parse(deployment.data)
      } catch (err) {
        res.status(400)
        return {
          errors: [{ data: err.message }],
        }
      }
      if (deploymentData) {
        const validationErrors = validateDeployment(deploymentData, userGroups)
        if (validationErrors) {
          res.status(400)
          return validationErrors
        }
        const { statefulSet, servicePayloads } = makeStatefulSet(
          statefulSetName,
          deploymentData
        )
        try {
          const client = getKubernetesClient(servicesNamespace, k8s.AppsV1Api)
          const { body: existing } = await client.listNamespacedStatefulSet(
            servicesNamespace,
            undefined,
            undefined,
            undefined,
            `metadata.name=${statefulSetName}`
          )
          if (existing.items.length === 1) {
            await client.replaceNamespacedStatefulSet(
              statefulSetName,
              servicesNamespace,
              statefulSet
            )
          } else {
            await client.createNamespacedStatefulSet(
              servicesNamespace,
              statefulSet
            )
            res.status(201)
          }
        } catch (err) {
          return handleErrorResponse(res, err)
        }

        for (const payload of servicePayloads) {
          const serviceName = `${statefulSetName}-${payload.name}`
          const service = makeService(
            statefulSetName,
            serviceName,
            payload.ports
          )
          try {
            const client = getKubernetesClient(servicesNamespace)
            const { body: existing } = await client.listNamespacedService(
              servicesNamespace,
              undefined,
              undefined,
              undefined,
              `metadata.name=${serviceName}`
            )
            if (existing.items.length === 1) {
              await client.replaceNamespacedService(
                serviceName,
                servicesNamespace,
                service
              )
            } else {
              await client.createNamespacedService(servicesNamespace, service)
              res.status(201)
            }
          } catch (err) {
            return handleErrorResponse(res, err)
          }
        }

        return deploymentData
      }
      res.status(404)
      return { message: 'api_errors.not_found' }
    }, context)
  )
}
