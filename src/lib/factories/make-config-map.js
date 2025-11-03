import k8s from '@kubernetes/client-node'
import { servicesNamespace } from '../config.js'

export function makeConfigMap(name, data) {
  const configMap = new k8s.V1ConfigMap()
  configMap.metadata = new k8s.V1ObjectMeta()
  configMap.metadata.name = name
  configMap.metadata.namespace = servicesNamespace
  configMap.data = data
  return configMap
}
