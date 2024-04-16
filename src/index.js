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
    function getNameSlug (name) {
      return slugify(name, {
        replacement: '-',
        lower: true,
        strict: true,
        trim: true
      })
    }
    function getDeploymentName (user, name) {
      const nameSlug = getNameSlug(name)
      return `sd-${nameSlug}`
    }
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

    router.get('/deployments/:id', baseRequestHandler(async (ctx) => {
      const {req, res, user, services} = ctx
      const {ItemsService} = services
      const deploymentsService = new ItemsService('deployments', {schema: req.schema, accountability: req.accountability})
      const deployment = await deploymentsService.readOne(req.params.id)
      if (!deployment) {
        return res.status(404).send('No such deployment found')
      }
      const statefulSetName = getDeploymentName(user, deployment.id)
      try {
        const appsClient = getKubernetesClient('services', k8s.AppsV1Api)
        const coreClient = getKubernetesClient('services')
        const { body:statefulSet } = await appsClient.readNamespacedStatefulSet(statefulSetName, 'services')
        const { body:podsBody } = await coreClient.listNamespacedPod('services', undefined, undefined, undefined, undefined, `app=${statefulSetName}`)
        const { items:pods } = podsBody
        const { body:volumeClaimsBody } = await coreClient.listNamespacedPersistentVolumeClaim('services', undefined, undefined, undefined, undefined, `app=${statefulSetName}`)
        const { items:volumeClaims } = volumeClaimsBody
        return {
          replicas: statefulSet.status.replicas,
          currentReplicas: statefulSet.status.currentReplicas,
          pods: pods.map(pod => {
            return {
              name: pod.metadata.name,
              phase: pod.status.phase,
              containers: pod.status.containerStatuses.map(container => {
                return {
                  name: container.name,
                  ready: container.ready,
                  started: container.started
                }
              })
            }
          }),
          volumes: volumeClaims.map(vc => {
            return {
              name: vc.metadata.name,
              phase: vc.status.phase,
              capacity: vc.status.capacity?.storage
            }
          })
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
    }, context))

    router.delete('/deployments/:id', baseRequestHandler(async (ctx) => {
      const {req, res, user, services} = ctx
      const {ItemsService} = services
      const deploymentsService = new ItemsService('deployments', {schema: req.schema, accountability: req.accountability})
      const deployment = await deploymentsService.readOne(req.params.id)
      if (!deployment) {
        return res.status(404).send('No such deployment found')
      }
      const statefulSetName = getDeploymentName(user, deployment.id)
      try {
        const appsClient = getKubernetesClient('services', k8s.AppsV1Api)
        const coreClient = getKubernetesClient('services')
        const { body:podsBody } = await coreClient.listNamespacedPod('services', undefined, undefined, undefined, undefined, `app=${statefulSetName}`)
        const { items:pods } = podsBody
        await appsClient.deleteNamespacedStatefulSet(statefulSetName, 'services', undefined, undefined, undefined, undefined, 'Background')
        for (const pod of pods) {
          for (const containerStatus of pod.status.containerStatuses) {
            const serviceName = `${statefulSetName}-${containerStatus.name}`
            await coreClient.deleteNamespacedService(serviceName, 'services', undefined, undefined, undefined, undefined, 'Background')
          }
        }
        const { body:volumeClaimsBody } = await coreClient.listNamespacedPersistentVolumeClaim('services', undefined, undefined, undefined, undefined, `app=${statefulSetName}`)
        const { items:volumeClaims } = volumeClaimsBody
        for (const claim of volumeClaims) {
          await coreClient.deleteNamespacedPersistentVolumeClaim(claim.metadata.name, 'services', undefined, undefined, undefined, undefined, 'Background')
        }
        return { deleted: deployment.id }
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
    }, context))

    router.put('/deployments/:id', baseRequestHandler(async (ctx) => {
      const {req, res, user, services} = ctx
      const {ItemsService} = services
      const deploymentsService = new ItemsService('deployments', {schema: req.schema, accountability: req.accountability})
      const deployment = await deploymentsService.readOne(req.params.id)
      if (!deployment) {
        return res.status(404).send('No such deployment found')
      }
      const statefulSetName = getDeploymentName(user, deployment.id)

      const deploymentData = parse(deployment.data)
      if (deploymentData) {
        const validationErrors = validateDeployment(deploymentData)
        if (validationErrors) {
          res.status(400)
          return validationErrors
        }
        const { statefulSet, servicePayloads } = makeStatefulSet(statefulSetName, deploymentData)
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

        return deploymentData
      }
      res.status(404)
      return {message: 'api_errors.not_found'}
    }, context))
	}
}
