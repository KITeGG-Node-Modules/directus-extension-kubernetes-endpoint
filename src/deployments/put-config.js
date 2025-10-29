import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { getDeploymentName, handleErrorResponse } from '../lib/util.js'
import { parse } from 'yaml'
import { makeConfigMap } from '../lib/make-config-map.js'
import { servicesNamespace } from '../lib/config.js'

export function putConfig(router, context) {
  router.put(
    '/deployments/:id/config',
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
      let configMapData = {}
      try {
        if (typeof req.body?.data === 'string') {
          configMapData = parse(req.body?.data)
        } else {
          configMapData = req.body?.data
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
      if (Object.keys(configMapData).length) {
        const configMap = makeConfigMap(statefulSetName, configMapData)
        try {
          const client = getKubernetesClient(servicesNamespace)
          const { body: existing } = await client.listNamespacedConfigMap(
            servicesNamespace,
            undefined,
            undefined,
            undefined,
            `metadata.name=${statefulSetName}`
          )
          if (existing.items.length === 1) {
            await client.replaceNamespacedConfigMap(
              statefulSetName,
              servicesNamespace,
              configMap
            )
          } else {
            await client.createNamespacedConfigMap(servicesNamespace, configMap)
            res.status(201)
          }
        } catch (err) {
          return handleErrorResponse(res, err)
        }

        return configMapData
      }
      res.status(400)
      return { message: 'api_errors.bad_request' }
    }, context)
  )
}
