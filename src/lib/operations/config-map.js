import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { makeConfigMap } from '../factories/config-map.js'
import { LABEL_NAMESPACE } from '../variables.js'

export async function createOrReplaceConfigMap(object, userId) {
  const payload = makeConfigMap(object, userId)
  const client = getKubernetesClient(undefined, k8s.CoreV1Api)
  const { body: existing } = await client.listNamespacedConfigMap(
    payload.metadata.namespace,
    undefined,
    undefined,
    undefined,
    `metadata.name=${payload.metadata.name}`
  )
  let result
  if (existing.items.length === 1) {
    result = await client.replaceNamespacedConfigMap(
      payload.metadata.name,
      payload.metadata.namespace,
      payload
    )
  } else {
    result = await client.createNamespacedConfigMap(
      payload.metadata.namespace,
      payload
    )
  }
  if (result.response) return result.response.body
}

export async function removeConfigMap(id) {
  const appsClient = getKubernetesClient(undefined, k8s.CoreV1Api)
  const { body: existing } = await appsClient.listConfigMapForAllNamespaces(
    undefined,
    undefined,
    undefined,
    `${LABEL_NAMESPACE}/objectId=${id}`,
    1
  )
  if (existing.items.length > 0) {
    for (const item of existing.items) {
      await appsClient.deleteNamespacedConfigMap(
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
