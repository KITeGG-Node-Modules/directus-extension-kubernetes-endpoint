import k8s from '@kubernetes/client-node'
import { servicesNamespace } from './config.js'
import { APP_LABEL_KEY } from './constants.js'

export function makeConfigMap(name, data) {
  const configMap = new k8s.V1ConfigMap()
  configMap.metadata = new k8s.V1ObjectMeta()
  configMap.metadata.name = name
  configMap.metadata.namespace = servicesNamespace
  configMap.metadata.labels = { [APP_LABEL_KEY]: name }
  configMap.data = data
  return configMap
}
