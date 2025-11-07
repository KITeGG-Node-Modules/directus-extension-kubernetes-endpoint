import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { makeSecret } from '../factories/secret.js'

export async function createOrReplaceSecret(object, res = undefined) {
  const payload = makeSecret(object)
  const client = getKubernetesClient(undefined, k8s.CoreV1Api)
  const { body: existing } = await client.listNamespacedSecret(
    object.namespace,
    undefined,
    undefined,
    undefined,
    `metadata.name=${object.name}`
  )
  let result
  if (existing.items.length === 1) {
    result = await client.replaceNamespacedSecret(
      object.name,
      object.namespace,
      payload
    )
  } else {
    result = await client.createNamespacedSecret(object.namespace, payload)
    if (res) res.status(201)
  }
  if (result.response) return result.response.body
}

export async function removeSecret(id) {
  const appsClient = getKubernetesClient(undefined, k8s.CoreV1Api)
  const { body: existing } = await appsClient.listSecretForAllNamespaces(
    undefined,
    undefined,
    undefined,
    `llp.kitegg.de/objectId=${id}`,
    1
  )
  if (existing.items.length > 0) {
    for (const item of existing.items) {
      await appsClient.deleteNamespacedSecret(
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
