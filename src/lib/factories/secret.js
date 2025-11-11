import k8s from '@kubernetes/client-node'
import { genericMetadata } from '../util/k8s.js'

export function makeSecret(payload, userId) {
  const secret = new k8s.V1Secret()
  secret.metadata = genericMetadata(payload, userId)
  secret.type = 'Opaque'
  secret.stringData = payload.data
  return secret
}
