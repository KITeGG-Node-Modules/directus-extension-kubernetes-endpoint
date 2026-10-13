import k8s from '@kubernetes/client-node'
import { DEFAULT_CPU, DEFAULT_MEMORY_GI, NUMBER_UNITS } from './constants.js'
import { formatQuantity } from './quantity.js'

export function makeContainer(c, servicePayloads, statefulSetName) {
  const container = new k8s.V1Container()
  container.name = c.name
  container.image = c.image
  container.command = c.command
  container.args = c.args
  container.imagePullPolicy = 'Always'
  container.securityContext = new k8s.V1SecurityContext()
  container.securityContext.allowPrivilegeEscalation = false

  if (typeof c.user === 'number') {
    container.securityContext.runAsUser = c.user
  }
  if (typeof c.group === 'number') {
    container.securityContext.runAsGroup = c.group
  }

  // Always limit cpu/memory: without limits a container runs BestEffort
  // and can exhaust worker nodes. GPU resources are added on top.
  // Capacity values may be numbers (interpreted in NUMBER_UNITS) or
  // Kubernetes quantity strings ('500m', '2Gi'); both are normalized here.
  container.resources = new k8s.V1ResourceRequirements()
  container.resources.limits = {
    cpu:
      formatQuantity(c.cpu || DEFAULT_CPU, NUMBER_UNITS.cpu) ??
      `${DEFAULT_CPU}`,
    memory:
      formatQuantity(c.memory || DEFAULT_MEMORY_GI, NUMBER_UNITS.memory) ??
      `${DEFAULT_MEMORY_GI}Gi`,
  }
  if (c.gpu) {
    container.resources.limits[c.gpu] = c.gpuCount || 1
    // Extended resources cannot be overcommitted, so requests must equal the
    // limits; declaring them explicitly makes the reserved resources visible
    // to cluster capacity accounting instead of relying on Kubernetes'
    // implicit defaulting of requests from limits.
    container.resources.requests = { ...container.resources.limits }
  }

  if (Array.isArray(c.ports)) {
    container.ports = c.ports.map((p) => {
      const containerPort = new k8s.V1ContainerPort()
      containerPort.name = p.name
      containerPort.containerPort = p.port
      return containerPort
    })
    servicePayloads?.push({ name: c.name, ports: c.ports })
  }

  container.env = (c.environment || []).map((e) => {
    const envVar = new k8s.V1EnvVar()
    envVar.name = e.name
    if (e.fromSecret) {
      envVar.valueFrom = new k8s.V1EnvVarSource()
      envVar.valueFrom.secretKeyRef = new k8s.V1SecretKeySelector()
      envVar.valueFrom.secretKeyRef.name = statefulSetName
      envVar.valueFrom.secretKeyRef.key = e.fromSecret
    } else if (e.fromConfig) {
      envVar.valueFrom = new k8s.V1EnvVarSource()
      envVar.valueFrom.configMapKeyRef = new k8s.V1ConfigMapKeySelector()
      envVar.valueFrom.configMapKeyRef.name = statefulSetName
      envVar.valueFrom.configMapKeyRef.key = e.fromConfig
    } else {
      envVar.value = e.value
    }
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
}
