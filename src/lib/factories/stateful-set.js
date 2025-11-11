import k8s from '@kubernetes/client-node'
import { DateTime } from 'luxon'
import { makeVolumeClaim } from './volume-claim.js'
import { makeContainer } from './container.js'
import { genericMetadata } from '../util/k8s.js'
import { isSuffixedVolumeName } from '../util/helpers.js'

export function makeStatefulSet(payload, userId) {
  const servicePayloads = []

  const statefulSet = new k8s.V1StatefulSet()
  statefulSet.metadata = genericMetadata(payload, userId)
  const spec = new k8s.V1StatefulSetSpec()
  spec.replicas = payload.replicas || 1
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
      return makeContainer(c, servicePayloads, payload.name)
    })
  }

  podSpec.containers = parseContainers(payload.containers)
  if (payload.initContainers) {
    podSpec.initContainers = parseContainers(payload.initContainers)
  }

  podSpec.volumes = (payload.volumes || [])
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

  spec.volumeClaimTemplates = (payload.volumes || [])
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
