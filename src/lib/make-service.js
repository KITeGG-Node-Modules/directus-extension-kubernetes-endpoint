import k8s from '@kubernetes/client-node'
import { servicesNamespace } from './config.js'
import { APP_LABEL_KEY } from './constants.js'

export function makeService(statefulSetName, name, ports) {
  const servicePayload = new k8s.V1Service()
  servicePayload.metadata = new k8s.V1ObjectMeta()
  servicePayload.metadata.name = name
  servicePayload.metadata.namespace = servicesNamespace
  servicePayload.metadata.labels = { [APP_LABEL_KEY]: statefulSetName }
  servicePayload.spec = new k8s.V1ServiceSpec()
  servicePayload.spec.selector = {
    [APP_LABEL_KEY]: statefulSetName,
  }
  servicePayload.spec.ports = (ports || []).map((p) => {
    const servicePort = new k8s.V1ServicePort()
    servicePort.name = p.name
    servicePort.port = p.port
    return servicePort
  })
  return servicePayload
}

/**
 * Headless service for the deployment (clusterIP: None, no ports):
 * `sd-<id>.services.svc.cluster.local` resolves to the pod IPs. This is how
 * other deployments of the same owners reach a deployment — ClusterIPs are
 * unreachable by the static egress policy, and per-deployment ingress
 * policies decide which deployments may connect. It also backs the
 * StatefulSet's `serviceName`, which has no governing service otherwise.
 */
export function makeHeadlessService(statefulSetName) {
  const servicePayload = new k8s.V1Service()
  servicePayload.metadata = new k8s.V1ObjectMeta()
  servicePayload.metadata.name = statefulSetName
  servicePayload.metadata.namespace = servicesNamespace
  servicePayload.metadata.labels = { [APP_LABEL_KEY]: statefulSetName }
  servicePayload.spec = new k8s.V1ServiceSpec()
  servicePayload.spec.selector = {
    [APP_LABEL_KEY]: statefulSetName,
  }
  servicePayload.spec.clusterIP = 'None'
  return servicePayload
}
