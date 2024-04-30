import k8s from '@kubernetes/client-node'
import { servicesNamespace } from './config.js'

export function makeService(statefulSetName, name, ports) {
  const servicePayload = new k8s.V1Service()
  servicePayload.metadata = new k8s.V1ObjectMeta()
  servicePayload.metadata.name = name
  servicePayload.metadata.namespace = servicesNamespace
  servicePayload.spec = new k8s.V1ServiceSpec()
  servicePayload.spec.selector = {
    app: statefulSetName,
  }
  servicePayload.spec.ports = (ports || []).map((p) => {
    const servicePort = new k8s.V1ServicePort()
    servicePort.name = p.name
    servicePort.port = p.port
    return servicePort
  })
  return servicePayload
}
