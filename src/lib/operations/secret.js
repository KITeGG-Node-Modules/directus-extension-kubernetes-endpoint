import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { makeSecret } from '../factories/secret.js'
import { LABEL_NAMESPACE } from '../variables.js'

export async function createOrReplaceSecret(object, userId) {
  const payload = makeSecret(object, userId)
  const client = getKubernetesClient(undefined, k8s.CoreV1Api)
  const { body: existing } = await client.listNamespacedSecret(
    payload.metadata.namespace,
    undefined,
    undefined,
    undefined,
    `metadata.name=${payload.metadata.name}`
  )
  let result
  if (existing.items.length === 1) {
    result = await client.replaceNamespacedSecret(
      payload.metadata.name,
      payload.metadata.namespace,
      payload
    )
  } else {
    result = await client.createNamespacedSecret(
      payload.metadata.namespace,
      payload
    )
  }
  if (result.response) return result.response.body
}

export async function removeSecret(id) {
  const appsClient = getKubernetesClient(undefined, k8s.CoreV1Api)
  const { body: existing } = await appsClient.listSecretForAllNamespaces(
    undefined,
    undefined,
    undefined,
    `${LABEL_NAMESPACE}/objectId=${id}`,
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
