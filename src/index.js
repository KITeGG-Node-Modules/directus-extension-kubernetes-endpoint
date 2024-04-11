import { getWorkers } from './get-workers.js'
import { baseRequestHandler, getKubernetesClient } from 'kitegg-directus-extension-common'
import { parse } from 'yaml'
import k8s from '@kubernetes/client-node'
import validate from 'validate.js'

export default {
	id: 'kubernetes',
	handler: (router, context) => {

    function handleValidationError (res, validationError = undefined) {
      if (validationError) {
        res.status(400)
        return validationError
      }
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

    router.post('/services', baseRequestHandler(async (ctx) => {
      const client = getKubernetesClient('services', k8s.AppsV1Api)
      const {req, res, user} = ctx
      const { data } = req.body
      const { deployment } = parse(data)
      if (deployment) {
        const validationError = validate.single(deployment.services, { presence: true, type: 'array' })
        if (handleValidationError(res, validationError)) return validationError

        for (const service of deployment.services) {
          const validationErrors = validate(service, {
            name: {
              presence: true,
              type: 'string'
            },
            image: {
              presence: true,
              type: 'string'
            },
            port: {
              presence: true,
              type: 'number'
            }
          })
          if (handleValidationError(res, validationErrors)) return validationErrors

          for (const volume of service.volumes || []) {
            const validationErrors = validate(volume, {
              name: {
                presence: true,
                type: 'string'
              },
              mountPath: {
                presence: true,
                type: 'string'
              },
              size: {
                presence: true,
                type: 'string',
                format: {
                  pattern: "^\\d{1,3}(?:Mi|Gi){1}$",
                  // flags: "i",
                  message: "must be one to three digits followed by Mi or Gi"
                }
              },
              readOnly: {
                type: 'boolean'
              }
            })
            if (handleValidationError(res, validationErrors)) return validationErrors
          }

          const serviceName = `${user.id}-${service.name}`
          const metadata = new k8s.V1ObjectMeta()
          metadata.name = serviceName
          metadata.namespace = 'services'
          const statefulSet = new k8s.V1StatefulSet()
          statefulSet.metadata = metadata
          const spec = new k8s.V1StatefulSetSpec()
          spec.replicas = 1
          spec.serviceName = serviceName
          const selector = new k8s.V1LabelSelector()
          selector.matchLabels = {
            app: serviceName
          }
          spec.selector = selector
          const podTemplateSpec = new k8s.V1PodTemplateSpec()
          podTemplateSpec.metadata = new k8s.V1ObjectMeta()
          podTemplateSpec.metadata.labels = {
            app: serviceName
          }
          const podSpec = new k8s.V1PodSpec()
          podSpec.nodeSelector = {
            'node-role.kubernetes.io/worker': 'worker'
          }
          podSpec.restartPolicy = 'Always'
          const container = new k8s.V1Container()
          container.name = serviceName
          container.image = service.image
          container.imagePullPolicy = 'Always'
          if (service.gpu) {
            container.resources = new k8s.V1ResourceRequirements()
            container.resources.limits = {
              [service.gpu]: 1
            }
          }
          container.ports = ([service.port] || []).map(p => {
            const containerPort = new k8s.V1ContainerPort()
            containerPort.containerPort = p
            return containerPort
          })
          container.env = (service.env || []).map((e => {
            const envVar = new k8s.V1EnvVar()
            envVar.name = e.name
            envVar.value = e.value
            return envVar
          }))
          container.volumeMounts = (service.volumes || []).map((v => {
            const volumeMount = new k8s.V1VolumeMount()
            volumeMount.name = v.name
            volumeMount.mountPath = v.mountPath
            volumeMount.readOnly = !!v.readOnly
            return volumeMount
          }))
          podSpec.containers = [container]
          podTemplateSpec.spec = podSpec
          spec.template = podTemplateSpec
          spec.volumeClaimTemplates = (service.volumes || []).map(v => {
            const volumeClaim = new k8s.V1PersistentVolumeClaim()
            volumeClaim.metadata = new k8s.V1ObjectMeta()
            volumeClaim.metadata.name = v.name
            volumeClaim.spec = new k8s.V1PersistentVolumeClaimSpec()
            volumeClaim.spec.storageClassName = 'longhorn'
            volumeClaim.spec.accessModes = ['ReadWriteOnce']
            volumeClaim.spec.resources = new k8s.V1ResourceRequirements()
            volumeClaim.spec.resources.requests = {
              storage: v.size
            }
            return volumeClaim
          })
          statefulSet.spec = spec

          try {
            const { body: existing } = await client.listNamespacedStatefulSet('services', undefined, undefined, undefined, `metadata.name=${serviceName}`)
            if (existing.items.length === 1) {
              await client.replaceNamespacedStatefulSet(serviceName, 'services', statefulSet)
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
        }
      }
      return deployment
    }, context))
	}
}
