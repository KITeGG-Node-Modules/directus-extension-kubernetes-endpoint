import { makeDeployment } from '../factories/make-deployment.js'
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
