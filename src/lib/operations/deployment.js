import { makeDeployment } from '../factories/deployment.js'
import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { LABEL_NAMESPACE } from '../config.js'

export async function createOrReplaceDeployment(deploymentObject, userId) {
  const payload = makeDeployment(deploymentObject, userId)
  const client = getKubernetesClient(undefined, k8s.AppsV1Api)
  const { body: existing } = await client.listNamespacedDeployment(
    payload.metadata.namespace,
    undefined,
    undefined,
    undefined,
    `metadata.name=${payload.metadata.name}`
  )
  let result
  if (existing.items.length === 1) {
    result = await client.replaceNamespacedDeployment(
      payload.metadata.name,
      payload.metadata.namespace,
      payload
    )
  } else {
    result = await client.createNamespacedDeployment(
      payload.metadata.namespace,
      payload
    )
  }
  if (result.response) return result.response.body
}

export async function removeDeployment(id) {
  const client = getKubernetesClient(undefined, k8s.AppsV1Api)
  const { body: existing } = await client.listDeploymentForAllNamespaces(
    undefined,
    undefined,
    undefined,
    `${LABEL_NAMESPACE}/objectId=${id}`,
    1
  )
  if (existing.items.length > 0) {
    for (const item of existing.items) {
      await client.deleteNamespacedDeployment(
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
