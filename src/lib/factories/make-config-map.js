import k8s from '@kubernetes/client-node'
import { servicesNamespace } from '../config.js'
import { genericMetadata } from '../util.js'

export function makeConfigMap(payload) {
  const configMap = new k8s.V1ConfigMap()
  configMap.metadata = genericMetadata(payload)
  configMap.data = payload.data
  return configMap
}
