import { getWorkers } from './get-workers.js'
import { baseRequestHandler, getKubernetesClient } from 'kitegg-directus-extension-common'
import { parse } from 'yaml'
import k8s from '@kubernetes/client-node'
import slugify from 'slugify'
import { validateDeployment } from './validate-deployment.js'
import { makeStatefulSet } from './make-stateful-set.js'
import { makeService } from './make-service.js'

export default {
	id: 'kubernetes',
	handler: (router, context) => {
    router.get('/capacity', baseRequestHandler(async () => {
      const workers = await getWorkers()
      const results = []
      for (const worker of workers) {
        const result = { name: worker.name }
        result.available = {}
        for (const key in worker.allocatable) {
          if (key.startsWith('nvidia')) {
            result.available[key] = worker.allocatable[key]
          }
        }
        result.requested = {}
        for (const key in worker.resources.limits) {
          if (key.startsWith('nvidia')) {
            result.requested[key] = worker.resources.limits[key]
          }
        }
        results.push(result)
      }
      return results
    }, context))

    router.get('/services', baseRequestHandler(async (ctx) => {
      const {req, res, user, services} = ctx
    }, context))

    router.post('/services/:id/deploy', baseRequestHandler(async (ctx) => {
      const {req, res, user, services} = ctx
      const {ItemsService} = services
      const itemsService = new ItemsService('docker_services', {schema: req.schema, accountability: req.accountability})
      const dockerService = await itemsService.readOne(req.params.id)
      const deployment = parse(dockerService.deployment)
      if (deployment) {
        const validationErrors = validateDeployment(deployment)
        if (validationErrors) {
          res.status(400)
          return validationErrors
        }

        const nameSlug = slugify(dockerService.name, {
          replacement: '-',
          lower: true,
          strict: true,
          trim: true
        })
        const statefulSetName = `user-${user.id}-${nameSlug}`
        const { statefulSet, servicePayloads } = makeStatefulSet(statefulSetName, deployment)
        try {
          const client = getKubernetesClient('services', k8s.AppsV1Api)
          const { body: existing } = await client.listNamespacedStatefulSet('services', undefined, undefined, undefined, `metadata.name=${statefulSetName}`)
          if (existing.items.length === 1) {
            await client.replaceNamespacedStatefulSet(statefulSetName, 'services', statefulSet)
          } else {
            await client.createNamespacedStatefulSet('services', statefulSet)
            res.status(201)
          }
        }
        catch (err) {
          if (err.body) {
            res.status(err.body.code)
            return err.body.message
          }
          console.error(err)
          res.status(500)
          return err.message
        }

        for (const payload of servicePayloads) {
          const serviceName = `${statefulSetName}-${payload.name}`
          const service = makeService(serviceName, payload.ports)

          try {
            const client = getKubernetesClient('services')
            const {body: existing} = await client.listNamespacedService('services', undefined, undefined, undefined, `metadata.name=${serviceName}`)
            if (existing.items.length === 1) {
              await client.replaceNamespacedService(serviceName, 'services', service)
            } else {
              await client.createNamespacedService('services', service)
              res.status(201)
            }
          } catch (err) {
            if (err.body) {
              res.status(err.body.code)
              return err.body.message
            }
            console.error(err)
            res.status(500)
            return err.message
          }
        }

        return deployment
      }
      res.status(404)
      return {message: 'api_errors.not_found'}
    }, context))
	}
}
