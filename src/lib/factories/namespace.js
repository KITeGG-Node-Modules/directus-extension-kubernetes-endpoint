import k8s from '@kubernetes/client-node'
import { genericMetadata, getNamespace } from '../util.js'

export function makeNamespace(payload) {
  const namespace = new k8s.V1Namespace()
  namespace.metadata = genericMetadata(payload)
  return namespace
}
