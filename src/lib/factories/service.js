import k8s from '@kubernetes/client-node'
import { genericMetadata } from '../util.js'

export function makeService(payload, userId) {
  const service = new k8s.V1Service()
  service.metadata = genericMetadata(payload, userId)
  service.spec = new k8s.V1ServiceSpec()
  service.spec.selector = {
    app: payload.name,
  }
  const ports = [
    {
      name: payload.name,
      port: parseInt(payload.port),
      protocol: payload.protocol,
    },
  ]
  service.spec.ports = (ports || []).map((p) => {
    const servicePort = new k8s.V1ServicePort()
    servicePort.name = p.name
    servicePort.port = p.port
    servicePort.protocol = p.protocol
    return servicePort
  })
  return service
}
