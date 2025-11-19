import k8s from '@kubernetes/client-node'

export function makeContainer(c) {
  const container = new k8s.V1Container()
  container.name = c.name
  container.image = c.image
  container.command = c.command
  container.args = c.args
  // TODO: Make this configurable
  container.imagePullPolicy = 'Always'

  container.securityContext = new k8s.V1SecurityContext()
  container.securityContext.allowPrivilegeEscalation = false

  container.securityContext.runAsUser = c.securityContext?.runAsUser
  container.securityContext.runAsGroup = c.securityContext?.runAsGroup
  container.securityContext.fsUser = c.securityContext?.fsUser
  container.securityContext.fsGroup = c.securityContext?.fsGroup
  container.securityContext.fsGroupChangePolicy =
    c.securityContext?.fsGroupChangePolicy

  if (c.resources) {
    container.resources = new k8s.V1ResourceRequirements()
    if (typeof c.resources.requests?.memory === 'number') {
      c.resources.requests.memory = `${c.resources.requests.memory}Gi`
    }
    container.resources.requests = Object.assign({}, c.resources.requests)
    container.resources.limits = Object.assign(
      {},
      c.resources.limits || c.resources.requests
    )
  }

  if (Array.isArray(c.ports)) {
    container.ports = c.ports.map((p) => {
      const containerPort = new k8s.V1ContainerPort()
      containerPort.name = p.name
      containerPort.containerPort = p.port
      return containerPort
    })
  }

  container.env = (c.env || []).map((e) => {
    const envVar = new k8s.V1EnvVar()
    envVar.name = e.name
    if (e.valueFromSecret) {
      envVar.valueFrom = new k8s.V1EnvVarSource()
      envVar.valueFrom.secretKeyRef = new k8s.V1SecretKeySelector()
      envVar.valueFrom.secretKeyRef.name = e.valueFromSecret.name
      envVar.valueFrom.secretKeyRef.key = e.valueFromSecret.key
    } else if (e.valueFromConfig) {
      envVar.valueFrom = new k8s.V1EnvVarSource()
      envVar.valueFrom.configMapKeyRef = new k8s.V1ConfigMapKeySelector()
      envVar.valueFrom.configMapKeyRef.name = e.valueFromConfig.name
      envVar.valueFrom.configMapKeyRef.key = e.valueFromConfig.key
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
