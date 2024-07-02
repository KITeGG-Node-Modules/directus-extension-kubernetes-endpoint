import k8s from '@kubernetes/client-node'
import { servicesNamespace } from './config.js'

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
  const podSpec = new k8s.V1PodSpec()
  podSpec.nodeSelector = {
    'node-role.kubernetes.io/worker': 'worker',
  }
  podSpec.restartPolicy = 'Always'

  podSpec.containers = deployment.containers.map((c) => {
    const container = new k8s.V1Container()
    container.name = c.name
    container.image = c.image
    container.command = c.command
    container.args = c.args
    container.imagePullPolicy = 'Always'
    if (c.gpu) {
      container.resources = new k8s.V1ResourceRequirements()
      container.resources.limits = {
        [c.gpu]: c.gpuCount || 1,
      }
    }
    container.ports = (c.ports || []).map((p) => {
      const containerPort = new k8s.V1ContainerPort()
      containerPort.name = p.name
      containerPort.containerPort = p.port
      return containerPort
    })
    servicePayloads.push({ name: c.name, ports: c.ports })

    container.env = (c.environment || []).map((e) => {
      const envVar = new k8s.V1EnvVar()
      envVar.name = e.name
      envVar.value = e.value
      return envVar
    })
    container.volumeMounts = (c.volumeMounts || []).map((v) => {
      const volumeMount = new k8s.V1VolumeMount()
      volumeMount.name = v.name
      volumeMount.mountPath = v.mountPath
      volumeMount.readOnly = !!v.readOnly
      return volumeMount
    })
    return container
  })
  podTemplateSpec.spec = podSpec
  spec.template = podTemplateSpec

  spec.volumeClaimTemplates = (deployment.volumes || []).map((v) => {
    const volumeClaim = new k8s.V1PersistentVolumeClaim()
    volumeClaim.metadata = new k8s.V1ObjectMeta()
    volumeClaim.metadata.name = v.name
    volumeClaim.spec = new k8s.V1PersistentVolumeClaimSpec()
    volumeClaim.spec.storageClassName = 'longhorn'
    volumeClaim.spec.accessModes = [v.type || 'ReadWriteOnce']
    volumeClaim.spec.resources = new k8s.V1ResourceRequirements()
    volumeClaim.spec.resources.requests = {
      storage: v.size,
    }
    return volumeClaim
  })
  statefulSet.spec = spec

  return { statefulSet, servicePayloads }
}
