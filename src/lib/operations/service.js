import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { makeService } from '../factories/service.js'

export async function createOrReplaceService(object, res = undefined) {
  const payload = makeService(object)
  const client = getKubernetesClient(undefined, k8s.CoreV1Api)
  const { body: existing } = await client.listNamespacedService(
    object.namespace,
    undefined,
    undefined,
    undefined,
    `metadata.name=${object.name}`
  )
  let result
  if (existing.items.length === 1) {
    result = await client.replaceNamespacedService(
      object.name,
      object.namespace,
      payload
    )
  } else {
    result = await client.createNamespacedService(object.namespace, payload)
    if (res) res.status(201)
  }
  if (result.response) return result.response.body
}

export async function removeService(id) {
  const appsClient = getKubernetesClient(undefined, k8s.CoreV1Api)
  const { body: existing } = await appsClient.listServiceForAllNamespaces(
    undefined,
    undefined,
    undefined,
    `llp.kitegg.de/objectId=${id}`,
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
