import {
  baseRequestHandler,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
import { parse, stringify } from 'yaml'
import { servicesNamespace } from './lib/config.js'
import { validateDeployment } from './lib/validate-deployment.js'
import { makeStatefulSet } from './lib/make-stateful-set.js'
import { makeService } from './lib/make-service.js'
import { getClusterCapacity } from './get-cluster-capacity.js'
import { getDeploymentInfo } from './get-deployment-info.js'
import { getPodEvents } from './get-pod-events.js'
import { deleteDeployment } from './delete-deployment.js'
import { createStatefulSet } from './create-stateful-set.js'
import { getDeploymentName, handleErrorResponse } from './lib/util.js'
import { createService } from './create-service.js'
import k8s from '@kubernetes/client-node'
import { DateTime } from 'luxon'
import { makeSecret } from './lib/make-secret.js'
import { createSecret } from './create-secret.js'
import { makeConfigMap } from './lib/make-config-map.js'
import { createConfigMap } from './create-config-map.js'

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
          res.status(404)
          return { message: 'api_errors.not_found' }
        }
        try {
          const results = await getDeploymentInfo(user, deployment)
          return results
        } catch (err) {
          return handleErrorResponse(res, err)
        }
      }, context)
    )

    router.get(
      '/deployments/:id/hooks/restart',
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
        try {
          const statefulSetName = getDeploymentName(user, deployment.id)
          const client = getKubernetesClient(servicesNamespace, k8s.AppsV1Api)
          const { body: existing } = await client.listNamespacedStatefulSet(
            servicesNamespace,
            undefined,
            undefined,
            undefined,
            `metadata.name=${statefulSetName}`
          )
          if (existing.items.length === 1) {
            const patch = [
              {
                op: 'replace',
                path: '/spec/template/metadata/annotations',
                value: {
                  'llp.kitegg.de/restartedAt': DateTime.now().toISO(),
                },
              },
            ]
            const options = {
              headers: {
                'Content-type': k8s.PatchUtils.PATCH_FORMAT_JSON_PATCH,
              },
            }
            await client.patchNamespacedStatefulSet(
              statefulSetName,
              servicesNamespace,
              patch,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              options
            )
            return { success: true }
          }
          res.status(404)
          return { message: 'api_errors.not_found' }
        } catch (err) {
          return handleErrorResponse(res, err)
        }
      }, context)
    )

    router.get(
      '/deployments/:id/logs/:podName',
      baseRequestHandler(async (ctx) => {
        const { req, res, services } = ctx
        const { podName } = req.params
        if (!podName) {
          res.status(400)
          return { message: 'api_errors.pod_name_missing' }
        }
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
            sinceSeconds,
            undefined,
            !!req.query.timestamps
          )
          res.setHeader('content-type', 'text/plain')
          return body || ''
        } catch (err) {
          return handleErrorResponse(res, err)
        }
      }, context)
    )

    router.get(
      '/deployments/:id/events/:podName',
      baseRequestHandler(async (ctx) => {
        const { req, res, services } = ctx
        const { podName } = req.params
        if (!podName) {
          res.status(400)
          return { message: 'api_errors.pod_name_missing' }
        }
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
          return getPodEvents(podName)
        } catch (err) {
          return handleErrorResponse(res, err)
        }
      }, context)
    )

    router.patch(
      '/deployments/:id',
      baseRequestHandler(async (ctx) => {
        const { req, res, services, user } = ctx
        const { scale } = req.query
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
              const patch = [
                {
                  op: 'replace',
                  path: '/spec',
                  value: {
                    replicas: parseInt(scale),
                  },
                },
              ]
              const options = {
                headers: {
                  'Content-type': k8s.PatchUtils.PATCH_FORMAT_JSON_PATCH,
                },
              }
              await client.patchNamespacedStatefulSetScale(
                statefulSetName,
                servicesNamespace,
                patch,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                options
              )
              return { success: true }
            } else {
              res.status(404)
              return { message: 'api_errors.not_found' }
            }
          }
          res.status(400)
          return { message: 'api_errors.bad_request' }
        } catch (err) {
          return handleErrorResponse(res, err)
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
          res.status(404)
          return { message: 'api_errors.not_found' }
        }
        try {
          await deleteDeployment(user, deployment)
          return { deleted: deployment.id }
        } catch (err) {
          return handleErrorResponse(res, err)
        }
      }, context)
    )

    router.delete(
      '/deployments/:id/pods/:podName',
      baseRequestHandler(async (ctx) => {
        const { req, res, services } = ctx
        const { podName } = req.params
        if (!podName) {
          res.status(400)
          return { message: 'api_errors.pod_name_missing' }
        }
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
          const coreClient = getKubernetesClient(servicesNamespace)
          await coreClient.deleteNamespacedPod(podName, servicesNamespace)
          return { deleted: podName }
        } catch (err) {
          return handleErrorResponse(res, err)
        }
      }, context)
    )

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
          const validationErrors = validateDeployment(
            deploymentData,
            userGroups
          )
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
              await createService(res, service, serviceName)
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
          await createSecret(res, secret, statefulSetName)
        } catch (err) {
          return handleErrorResponse(res, err)
        }
        return secretData
      }, context)
    )

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
            await createConfigMap(res, configMap, statefulSetName)
          } catch (err) {
            return handleErrorResponse(res, err)
          }

          return configMapData
        }
        res.status(400)
        return { message: 'api_errors.bad_request' }
      }, context)
    )

    router.get(
      '/deployments/:id/config',
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
          const configMap = await coreClient.readNamespacedConfigMap(
            statefulSetName,
            servicesNamespace
          )
          return { data: configMap.body.data }
        } catch (err) {
          return handleErrorResponse(res, err)
        }
      }, context)
    )
  },
}
