import k8s from '@kubernetes/client-node'
import { genericMetadata } from '../util/k8s.js'

export function makeConfigMap(payload, userId) {
  const configMap = new k8s.V1ConfigMap()
  configMap.metadata = genericMetadata(payload, userId)
  configMap.data = payload.data
  return configMap
}
