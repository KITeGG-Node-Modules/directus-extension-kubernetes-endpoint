import k8s from '@kubernetes/client-node'
import { servicesNamespace } from './config.js'
import {
  NODE_SELECTOR,
  RESTART_ANNOTATION_KEY,
} from './constants.js'
import { makeVolumeClaim } from './make-volume-claim.js'
import { makeContainer } from './make-container.js'
import { isSuffixedVolumeName } from './util.js'

export function makeStatefulSet(name, deployment) {
  const servicePayloads = []

  const metadata = new k8s.V1ObjectMeta()
  metadata.name = name
  metadata.namespace = servicesNamespace
  const statefulSet = new k8s.V1StatefulSet()
  statefulSet.metadata = metadata
  const spec = new k8s.V1StatefulSetSpec()
  spec.replicas = deployment.replicas || 1
  if (deployment.podManagementPolicy)
    spec.podManagementPolicy = deployment.podManagementPolicy
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
    [RESTART_ANNOTATION_KEY]: new Date().toISOString(),
  }
  const podSpec = new k8s.V1PodSpec()
  podSpec.nodeSelector = NODE_SELECTOR
  podSpec.restartPolicy = deployment.restartPolicy || 'Always'
  podSpec.enableServiceLinks = false

  function parseContainers(containers, payloads) {
    return containers.map((c) => {
      // Pod-level filesystem ownership: must be a V1PodSecurityContext
      // (V1SecurityContext does not carry fsUser/fsGroup and would
      // silently drop them during serialization)
      podSpec.securityContext =
        podSpec.securityContext || new k8s.V1PodSecurityContext()
      if (c.fsUser != null) {
        podSpec.securityContext.fsUser = c.fsUser
      }
      if (c.fsGroup != null) {
        podSpec.securityContext.fsGroup = c.fsGroup
      }
      if (c.changeGroupOnMismatch) {
        podSpec.securityContext.fsGroupChangePolicy = 'OnRootMismatch'
      }
      return makeContainer(c, payloads, name)
    })
  }

  podSpec.containers = parseContainers(deployment.containers, servicePayloads)
  if (deployment.initContainers) {
    // Init containers are transient: they must not create services
    podSpec.initContainers = parseContainers(deployment.initContainers, null)
  }

  podSpec.volumes = (deployment.volumes || [])
    .map((v) => {
      if (v.emptyDir?.sizeLimit) {
        const volume = new k8s.V1Volume()
        volume.name = v.name
        volume.emptyDir = new k8s.V1EmptyDirVolumeSource()
        volume.emptyDir.sizeLimit = `${v.emptyDir.sizeLimit}Mi`
        volume.emptyDir.medium = 'Memory'
        return volume
      } else if (isSuffixedVolumeName(v.name)) {
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
      } else if (v.size) {
        return makeVolumeClaim(v, name)
      }
      return null
    })
    .filter((v) => !!v)

  statefulSet.spec = spec

  return { statefulSet, servicePayloads }
}
