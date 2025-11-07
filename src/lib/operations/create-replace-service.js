import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { makeService } from '../factories/make-service.js'

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
