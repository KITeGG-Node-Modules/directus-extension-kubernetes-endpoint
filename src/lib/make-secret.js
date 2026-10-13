import k8s from '@kubernetes/client-node'
import { servicesNamespace } from './config.js'
import { APP_LABEL_KEY } from './constants.js'

export function makeSecret(name, data) {
  const secret = new k8s.V1Secret()
  secret.metadata = new k8s.V1ObjectMeta()
  secret.metadata.name = name
  secret.metadata.namespace = servicesNamespace
  secret.metadata.labels = { [APP_LABEL_KEY]: name }
  secret.type = 'Opaque'
  secret.stringData = data
  return secret
}
