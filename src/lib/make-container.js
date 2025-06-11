import k8s from '@kubernetes/client-node'

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

  if (c.gpu) {
    container.resources = new k8s.V1ResourceRequirements()
    container.resources.limits = {
      cpu: c.cpu || 4,
      memory: `${c.memory || 32.0}Gi`,
      [c.gpu]: c.gpuCount || 1,
    }
  }

  if (Array.isArray(container.ports)) {
    container.ports = (c.ports || []).map((p) => {
      const containerPort = new k8s.V1ContainerPort()
      containerPort.name = p.name
      containerPort.containerPort = p.port
      return containerPort
    })
    servicePayloads.push({ name: c.name, ports: c.ports })
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
