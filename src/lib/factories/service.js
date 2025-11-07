import k8s from '@kubernetes/client-node'
import { genericMetadata } from '../util.js'
import { getKubernetesClient } from 'kitegg-directus-extension-common'

export function makeService(payload) {
  const service = new k8s.V1Service()
  service.metadata = genericMetadata(payload)
  service.spec = new k8s.V1ServiceSpec()
  service.spec.selector = {
    app: payload.name,
  }
  service.spec.ports = (payload.ports || []).map((p) => {
    const servicePort = new k8s.V1ServicePort()
    servicePort.name = p.name
    servicePort.port = p.port
    servicePort.protocol = p.protocol
    return servicePort
  })
  return service
}

export async function removeService(id, res = undefined) {
  const appsClient = getKubernetesClient(undefined, k8s.CoreV1Api)
  const { body: existing } = await appsClient.listServiceForAllNamespaces(
    undefined,
    undefined,
    undefined,
    `llp.kitegg.de/objectId=${id}`,
    1
  )
  if (existing.items.length > 0) {
    for (const item of existing.items) {
      await appsClient.deleteNamespacedService(
        item.metadata.name,
        item.metadata.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        'Background'
      )
    }
  }
  return { deleted: id }
}
