import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { makeVolumeClaim } from '../factories/make-volume-claim.js'

export async function createOrReplaceVolumeClaim(object, res = undefined) {
  const payload = makeVolumeClaim(object)
  const client = getKubernetesClient(undefined, k8s.CoreV1Api)
  const { body: existing } = await client.listNamespacedPersistentVolumeClaim(
    object.namespace,
    undefined,
    undefined,
    undefined,
    `metadata.name=${object.name}`
  )
  let result
  if (existing.items.length === 1) {
    result = await client.replaceNamespacedPersistentVolumeClaim(
      object.name,
      object.namespace,
      payload
    )
  } else {
    result = await client.createNamespacedPersistentVolumeClaim(
      object.namespace,
      payload
    )
    if (res) res.status(201)
  }
  if (result.response) return result.response.body
}
