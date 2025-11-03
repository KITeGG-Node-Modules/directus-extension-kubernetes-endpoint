import k8s from '@kubernetes/client-node'
import { servicesNamespace } from '../config.js'
import { DateTime } from 'luxon'
import { makeVolumeClaim } from './make-volume-claim.js'
import { makeContainer } from './make-container.js'
import { isSuffixedVolumeName } from '../util.js'

export function makeStatefulSet(name, deployment) {
  const servicePayloads = []

  const metadata = new k8s.V1ObjectMeta()
  metadata.name = name
  metadata.namespace = servicesNamespace
  const statefulSet = new k8s.V1StatefulSet()
  statefulSet.metadata = metadata
  const spec = new k8s.V1StatefulSetSpec()
  spec.replicas = deployment.replicas || 1
  spec.serviceName = name
  const selector = new k8s.V1LabelSelector()
  selector.matchLabels = {
    app: name,
  }
  spec.selector = selector
  const podTemplateSpec = new k8s.V1PodTemplateSpec()
  podTemplateSpec.metadata = new k8s.V1ObjectMeta()
  podTemplateSpec.metadata.labels = {
    app: name,
  }
  podTemplateSpec.metadata.annotations = {
    'llp.kitegg.de/restartedAt': DateTime.now().toISO(),
  }
  const podSpec = new k8s.V1PodSpec()
  podSpec.nodeSelector = {
    'node-role.kubernetes.io/worker': 'worker',
  }
  podSpec.restartPolicy = deployment.restartPolicy || 'Always'
  podSpec.enableServiceLinks = false

  function parseContainers(containers) {
    return containers.map((c) => {
      podSpec.securityContext =
        podSpec.securityContext || new k8s.V1SecurityContext()
      if (c.fsUser) {
        podSpec.securityContext.fsUser = c.fsUser
      }
      if (c.fsGroup) {
        podSpec.securityContext.fsGroup = c.fsGroup
      }
      if (c.changeGroupOnMismatch) {
        podSpec.securityContext.fsGroupChangePolicy = 'OnRootMismatch'
      }
      return makeContainer(c, servicePayloads, name)
    })
  }

  podSpec.containers = parseContainers(deployment.containers)
  if (deployment.initContainers) {
    podSpec.initContainers = parseContainers(deployment.initContainers)
  }

  podSpec.volumes = (deployment.volumes || [])
    .map((v) => {
      if (isSuffixedVolumeName(v.name)) {
        const volume = new k8s.V1Volume()
        volume.name = v.name
        volume.persistentVolumeClaim =
          new k8s.V1PersistentVolumeClaimVolumeSource()
        volume.persistentVolumeClaim.claimName = v.name
        return volume
      } else {
        return null
      }
    })
    .filter((v) => !!v)

  podTemplateSpec.spec = podSpec
  spec.template = podTemplateSpec

  spec.volumeClaimTemplates = (deployment.volumes || [])
    .map((v) => {
      if (isSuffixedVolumeName(v.name)) {
        return null
      } else {
        return makeVolumeClaim(v)
      }
    })
    .filter((v) => !!v)

  statefulSet.spec = spec

  return { statefulSet, servicePayloads }
}
