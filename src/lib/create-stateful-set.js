import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'

export async function createStatefulSet(res, statefulSet, statefulSetName) {
  const client = getKubernetesClient('services', k8s.AppsV1Api)
  const { body: existing } = await client.listNamespacedStatefulSet(
    'services',
    undefined,
    undefined,
    undefined,
    `metadata.name=${statefulSetName}`
  )
  if (existing.items.length === 1) {
    await client.replaceNamespacedStatefulSet(
      statefulSetName,
      'services',
      statefulSet
    )
  } else {
    await client.createNamespacedStatefulSet('services', statefulSet)
    res.status(201)
  }
}
