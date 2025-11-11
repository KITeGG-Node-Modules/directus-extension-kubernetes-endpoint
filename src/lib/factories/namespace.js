import k8s from '@kubernetes/client-node'
import { genericMetadata } from '../util/k8s.js'

export function makeNamespace(payload, userId) {
  const namespace = new k8s.V1Namespace()
  namespace.metadata = genericMetadata(payload, userId)
  return namespace
}
