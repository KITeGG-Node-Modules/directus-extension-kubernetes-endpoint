import k8s from '@kubernetes/client-node'
import { servicesNamespace } from '../config.js'
import { genericMetadata } from '../util.js'

export function makeSecret(payload, userId) {
  const secret = new k8s.V1Secret()
  secret.metadata = genericMetadata(payload, userId)
  secret.type = 'Opaque'
  secret.stringData = payload.data
  return secret
}
