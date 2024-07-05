import k8s from '@kubernetes/client-node'

export function makeContainer(c, servicePayloads) {
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
}
