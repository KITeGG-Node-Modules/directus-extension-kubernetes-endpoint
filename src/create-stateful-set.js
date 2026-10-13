import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { servicesNamespace } from './lib/config.js'
import { upsert } from './lib/upsert.js'

export async function createStatefulSet(statefulSet, statefulSetName) {
  const client = getKubernetesClient(servicesNamespace, k8s.AppsV1Api)
  return upsert({
    read: () =>
      client.readNamespacedStatefulSet(statefulSetName, servicesNamespace),
    create: () =>
      client.createNamespacedStatefulSet(servicesNamespace, statefulSet),
    update: () =>
      client.replaceNamespacedStatefulSet(
        statefulSetName,
        servicesNamespace,
        statefulSet
      ),
  })
}
