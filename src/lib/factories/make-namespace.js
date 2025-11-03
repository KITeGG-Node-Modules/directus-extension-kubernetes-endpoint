import k8s from '@kubernetes/client-node'
import { getNamespace } from '../util.js'

export function makeNamespace(user, payload) {
  const namespace = new k8s.V1Namespace()
  namespace.metadata = new k8s.V1ObjectMeta()
  namespace.metadata.name = getNamespace(user, payload.name)
  namespace.metadata.labels = {
    'llp.kitegg.de/objectId': payload.id,
  }
  return namespace
}
