import { makeDeployment } from '../factories/deployment.js'
import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'

export async function createOrReplaceDeployment(
  deploymentObject,
  res = undefined
) {
  const deployment = makeDeployment(deploymentObject)
  const client = getKubernetesClient(undefined, k8s.AppsV1Api)
  const { body: existing } = await client.listNamespacedDeployment(
    deploymentObject.namespace,
    undefined,
    undefined,
    undefined,
    `metadata.name=${deploymentObject.name}`
  )
  let result
  if (existing.items.length === 1) {
    result = await client.replaceNamespacedDeployment(
      deploymentObject.name,
      deploymentObject.namespace,
      deployment
    )
  } else {
    result = await client.createNamespacedDeployment(
      deploymentObject.namespace,
      deployment
    )
    if (res) res.status(201)
  }
  if (result.response) return result.response.body
}

export async function removeDeployment(id) {
  const client = getKubernetesClient(undefined, k8s.AppsV1Api)
  const { body: existing } = await client.listDeploymentForAllNamespaces(
    undefined,
    undefined,
    undefined,
    `llp.kitegg.de/objectId=${id}`,
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
