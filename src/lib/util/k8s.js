import { LABEL_NAMESPACE } from '../variables.js'
import { getNamespace, parseErrorResponse } from './helpers.js'
import k8s from '@kubernetes/client-node'
import { updateStatus } from './hooks.js'

export function genericMetadata(payload, userId) {
  const metadata = new k8s.V1ObjectMeta()
  metadata.name = payload.name
  if (userId && payload.namespace)
    metadata.namespace = getNamespace(userId, payload.namespace)
  const labels = {}
  if (userId) labels[`${LABEL_NAMESPACE}/userId`] = userId
  if (payload.id) labels[`${LABEL_NAMESPACE}/objectId`] = payload.id
  if (payload.user_created)
    labels[`${LABEL_NAMESPACE}/creatorId`] = payload.user_created
  metadata.labels = labels
  return metadata
}

export async function forwardToKubernetes(
  services,
  meta,
  context,
  handlerFunction
) {
  const { key, keys, collection } = meta
  const { schema, accountability } = context
  let ids
  if (key && !keys) {
    ids = [key]
  } else {
    ids = keys
  }
  for (const id of ids) {
    let _status, _errors, object
    try {
      const { ItemsService } = services
      const service = new ItemsService(collection, {
        schema,
        accountability,
      })
      object = await service.readOne(id)
    } catch {}
    try {
      _status = await handlerFunction(object || id, accountability.user)
      _errors = null
    } catch (err) {
      _status = null
      _errors = parseErrorResponse(err)
    }
    await updateStatus(services, context, collection, id, _status, _errors)
  }
}
