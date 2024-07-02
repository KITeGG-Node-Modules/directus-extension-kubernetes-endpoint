import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { parse } from 'yaml'
import { servicesNamespace } from './lib/config.js'
import { validateDeployment } from './lib/validate-deployment.js'
import { makeStatefulSet } from './lib/make-stateful-set.js'
import { makeService } from './lib/make-service.js'
import { getClusterCapacity } from './get-cluster-capacity.js'
import { getDeploymentInfo } from './get-deployment-info.js'
import { getPodEvents } from './get-pod-events.js'
import { deleteDeployment } from './delete-deployment.js'
import { createStatefulSet } from './create-stateful-set.js'
import { getDeploymentName } from './lib/util.js'
import { createService } from './create-service.js'
import k8s from '@kubernetes/client-node'

export default {
  id: 'kubernetes',
  handler: (router, context) => {
    router.get(
      '/capacity',
      baseRequestHandler(() => getClusterCapacity(), context)
    )

    router.get(
      '/deployments/:id',
      baseRequestHandler(async (ctx) => {
        const { req, res, user, services } = ctx
        const { ItemsService } = services
        const deploymentsService = new ItemsService('deployments', {
          schema: req.schema,
          accountability: req.accountability,
        })
        const deployment = await deploymentsService.readOne(req.params.id)
        if (!deployment) {
          return res.status(404).send('No such deployment found')
        }
        try {
          const results = await getDeploymentInfo(user, deployment)
          return results
        } catch (err) {
          if (err.body) {
            res.status(err.body.code)
            return err.body.message
          }
          console.error(err)
          res.status(500)
          return err.message
        }
      }, context)
    )

    router.get(
      '/deployments/:id/logs/:podName',
      baseRequestHandler(async (ctx) => {
        const { req, res, services } = ctx
        const { podName } = req.params
        if (!podName) {
          return res.status(400).send('Pod name missing')
        }
        const { ItemsService } = services
        const deploymentsService = new ItemsService('deployments', {
          schema: req.schema,
          accountability: req.accountability,
        })
        const deployment = await deploymentsService.readOne(req.params.id)
        if (!deployment) {
          return res.status(404).send('No such deployment found')
        }
        try {
          const coreClient = getKubernetesClient(servicesNamespace)
          const sinceSeconds = req.query.sinceSeconds
            ? parseInt(req.query.sinceSeconds)
            : undefined
          const { body } = await coreClient.readNamespacedPodLog(
            podName,
            servicesNamespace,
            req.query.container,
            false,
            undefined,
            undefined,
            undefined,
            !!req.query.previous,
            sinceSeconds
          )
          res.setHeader('content-type', 'text/plain')
          return body
        } catch (err) {
          if (err.body) {
            res.status(err.body.code)
            return err.body.message
          }
          console.error(err)
          res.status(500)
          return err.message
        }
      }, context)
    )

    router.get(
      '/deployments/:id/events/:podName',
      baseRequestHandler(async (ctx) => {
        const { req, res, services } = ctx
        const { podName } = req.params
        if (!podName) {
          return res.status(400).send('Pod name missing')
        }
        const { ItemsService } = services
        const deploymentsService = new ItemsService('deployments', {
          schema: req.schema,
          accountability: req.accountability,
        })
        const deployment = await deploymentsService.readOne(req.params.id)
        if (!deployment) {
          return res.status(404).send('No such deployment found')
        }
        try {
          return getPodEvents(podName)
        } catch (err) {
          if (err.body) {
            res.status(err.body.code)
            return err.body.message
          }
          console.error(err)
          res.status(500)
          return err.message
        }
      }, context)
    )

    router.patch(
      '/deployments/:id',
      baseRequestHandler(async (ctx) => {
        const { req, res, services } = ctx
        const { scale } = req.params
        if (!podName) {
          return res.status(400).send('Pod name missing')
        }
        const { ItemsService } = services
        const deploymentsService = new ItemsService('deployments', {
          schema: req.schema,
          accountability: req.accountability,
        })
        const deployment = await deploymentsService.readOne(req.params.id)
        if (!deployment) {
          return res.status(404).send('No such deployment found')
        }
        try {
          const statefulSetName = getDeploymentName(user, deployment.id)
          const client = getKubernetesClient(servicesNamespace, k8s.AppsV1Api)
          if (typeof scale !== 'undefined') {
            const { body: existing } = await client.listNamespacedStatefulSet(
              servicesNamespace,
              undefined,
              undefined,
              undefined,
              `metadata.name=${statefulSetName}`
            )
            if (existing.items.length === 1) {
              const scalePayload = new k8s.V1Scale()
              scalePayload.spec.replicas = parseInt(scale)
              await client.patchNamespacedStatefulSetScale(
                statefulSetName,
                servicesNamespace,
                scalePayload
              )
              return true
            } else {
              return res.status(404).send('No such deployment found')
            }
          }
          return res.status(400).send('Bad request')
        } catch (err) {
          if (err.body) {
            res.status(err.body.code)
            return err.body.message
          }
          console.error(err)
          res.status(500)
          return err.message
        }
      }, context)
    )

    router.delete(
      '/deployments/:id',
      baseRequestHandler(async (ctx) => {
        const { req, res, user, services } = ctx
        const { ItemsService } = services
        const deploymentsService = new ItemsService('deployments', {
          schema: req.schema,
          accountability: req.accountability,
        })
        const deployment = await deploymentsService.readOne(req.params.id)
        if (!deployment) {
          return res.status(404).send('No such deployment found')
        }
        try {
          await deleteDeployment(user, deployment)
          return { deleted: deployment.id }
        } catch (err) {
          if (err.body) {
            res.status(err.body.code)
            return err.body.message
          }
          console.error(err)
          res.status(500)
          return err.message
        }
      }, context)
    )

    router.delete(
      '/deployments/:id/pods/:podName',
      baseRequestHandler(async (ctx) => {
        const { req, res, services } = ctx
        const { podName } = req.params
        if (!podName) {
          return res.status(400).send('Pod name missing')
        }
        const { ItemsService } = services
        const deploymentsService = new ItemsService('deployments', {
          schema: req.schema,
          accountability: req.accountability,
        })
        const deployment = await deploymentsService.readOne(req.params.id)
        if (!deployment) {
          return res.status(404).send('No such deployment found')
        }
        try {
          const coreClient = getKubernetesClient(servicesNamespace)
          await coreClient.deleteNamespacedPod(podName, servicesNamespace)
          return { deleted: podName }
        } catch (err) {
          if (err.body) {
            res.status(err.body.code)
            return err.body.message
          }
          console.error(err)
          res.status(500)
          return err.message
        }
      }, context)
    )

    router.put(
      '/deployments/:id',
      baseRequestHandler(async (ctx) => {
        const { req, res, user, services } = ctx
        const { ItemsService } = services
        const deploymentsService = new ItemsService('deployments', {
          schema: req.schema,
          accountability: req.accountability,
        })
        const deployment = await deploymentsService.readOne(req.params.id)
        if (!deployment) {
          return res.status(404).send('No such deployment found')
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
          const validationErrors = validateDeployment(deploymentData)
          if (validationErrors) {
            res.status(400)
            return validationErrors
          }
          const { statefulSet, servicePayloads } = makeStatefulSet(
            statefulSetName,
            deploymentData
          )
          try {
            await createStatefulSet(res, statefulSet, statefulSetName)
          } catch (err) {
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
            const service = makeService(
              statefulSetName,
              serviceName,
              payload.ports
            )
            try {
              await createService(res, service, serviceName)
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
        return { message: 'api_errors.not_found' }
      }, context)
    )
  },
}
