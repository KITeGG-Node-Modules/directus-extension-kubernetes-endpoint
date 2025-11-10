import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { makeService } from '../factories/service.js'
import { LABEL_NAMESPACE } from '../variables.js'

export async function createOrReplaceService(object, userId) {
  const payload = makeService(object, userId)
  const client = getKubernetesClient(undefined, k8s.CoreV1Api)
  const { body: existing } = await client.listNamespacedService(
    payload.metadata.namespace,
    undefined,
    undefined,
    undefined,
    `metadata.name=${payload.metadata.name}`
  )
  let result
  if (existing.items.length === 1) {
    result = await client.replaceNamespacedService(
      payload.metadata.name,
      payload.metadata.namespace,
      payload
    )
  } else {
    result = await client.createNamespacedService(
      payload.metadata.namespace,
      payload
    )
  }
  if (result.response) return result.response.body
}

export async function removeService(id) {
  const appsClient = getKubernetesClient(undefined, k8s.CoreV1Api)
  const { body: existing } = await appsClient.listServiceForAllNamespaces(
    undefined,
    undefined,
    undefined,
    `${LABEL_NAMESPACE}/objectId=${id}`,
    1
  )
  if (existing.items.length > 0) {
    for (const item of existing.items) {
      await appsClient.deleteNamespacedService(
        item.metadata.name,
        item.metadata.namespace,
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
