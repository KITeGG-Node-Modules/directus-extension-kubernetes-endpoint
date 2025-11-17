import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { LABEL_NAMESPACE } from '../variables.js'
import { makeNamespace } from '../factories/namespace.js'
import { getNamespace } from '../util/helpers.js'

export async function createNamespace(object, userId) {
  const namespaceObject = {
    ...object,
    name: getNamespace(object.name),
  }
  const payload = makeNamespace(namespaceObject, userId)
  const client = getKubernetesClient(undefined, k8s.CoreV1Api)
  const result = await client.createNamespace(payload)
  if (result.response) return result.response.body
}

export async function removeNamespace(id) {
  const appsClient = getKubernetesClient(undefined, k8s.CoreV1Api)
  const { body: existing } = await appsClient.listNamespace(
    undefined,
    undefined,
    undefined,
    `${LABEL_NAMESPACE}/objectId=${id}`
  )
  if (existing.items.length > 0) {
    for (const item of existing.items) {
      await appsClient.deleteNamespace(
        item.metadata.name,
        undefined,
        undefined,
        undefined,
        undefined,
        'Background'
      )
    }
  }
  return { deleted: id }
}
