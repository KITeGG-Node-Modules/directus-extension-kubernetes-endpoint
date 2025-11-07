import k8s from '@kubernetes/client-node'
import { DateTime } from 'luxon'
import { makeContainer } from './container.js'
import { genericMetadata } from '../util.js'

export function makeDeployment(payload, userId) {
  const deployment = new k8s.V1Deployment()
  deployment.metadata = genericMetadata(payload, userId)

  const spec = new k8s.V1DeploymentSpec()
  spec.replicas = payload.replicas
  spec.serviceName = payload.name

  const selector = new k8s.V1LabelSelector()
  selector.matchLabels = {
    app: payload.name,
  }
  spec.selector = selector

  const podTemplateSpec = new k8s.V1PodTemplateSpec()
  podTemplateSpec.metadata = new k8s.V1ObjectMeta()
  podTemplateSpec.metadata.labels = {
    app: payload.name,
  }
  podTemplateSpec.metadata.annotations = {
    'llp.kitegg.de/restartedAt': DateTime.now().toISO(),
  }

  const podSpec = new k8s.V1PodSpec()
  podSpec.nodeSelector = {
    'node-role.kubernetes.io/worker': 'worker',
  }
  podSpec.restartPolicy = payload.restartPolicy || 'Always'
  podSpec.enableServiceLinks = false

  podSpec.initContainers = (payload.initContainers || []).map(makeContainer)
  podSpec.containers = (payload.containers || []).map(makeContainer)

  podSpec.volumes = (payload.initContainers || [])
    .concat(payload.containers || [])
    .reduce((acc, cur) => {
      for (const volume of cur.volumeMounts || []) {
        if (!acc.find((v) => v.name === volume.name)) {
          acc.push({
            name: volume.name,
            fromSecret: volume.fromSecret,
            fromConfig: volume.fromConfig,
          })
        }
      }
      return acc
    }, [])
    .map((v) => {
      const volume = new k8s.V1Volume()
      if (v.fromSecret) {
        volume.secret = new k8s.V1SecretVolumeSource()
        volume.secret.secretName = v.fromSecret.name
        volume.secret.items = v.fromSecret.keys
      } else if (v.fromConfig) {
        volume.configMap = new k8s.V1ConfigMapVolumeSource()
        volume.configMap.name = v.fromConfig.name
        volume.configMap.items = v.fromConfig.keys
      } else {
        volume.name = v.name
      }
      return volume
    })

  podTemplateSpec.spec = podSpec
  spec.template = podTemplateSpec

  deployment.spec = spec

  return deployment
}
