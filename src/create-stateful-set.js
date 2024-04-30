import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { servicesNamespace } from './lib/config.js'

export async function createStatefulSet(res, statefulSet, statefulSetName) {
  const client = getKubernetesClient(servicesNamespace, k8s.AppsV1Api)
  const { body: existing } = await client.listNamespacedStatefulSet(
    servicesNamespace,
    undefined,
    undefined,
    undefined,
    `metadata.name=${statefulSetName}`
  )
  if (existing.items.length === 1) {
    await client.replaceNamespacedStatefulSet(
      statefulSetName,
      servicesNamespace,
      statefulSet
    )
  } else {
    await client.createNamespacedStatefulSet(servicesNamespace, statefulSet)
    res.status(201)
  }
}
