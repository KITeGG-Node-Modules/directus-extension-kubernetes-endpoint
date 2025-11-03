import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'

export async function removeDeployment(deploymentObject, res = undefined) {
  const appsClient = getKubernetesClient(
    deploymentObject.namespace,
    k8s.AppsV1Api
  )
  await appsClient.deleteNamespacedDeployment(
    deploymentObject.name,
    deploymentObject.namespace,
    undefined,
    undefined,
    undefined,
    undefined,
    'Background'
  )
  return { deleted: deploymentObject.id }
}
