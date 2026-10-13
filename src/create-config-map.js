import { getKubernetesClient } from './lib/get-kubernetes-client.js'
import { servicesNamespace } from './lib/config.js'
import { upsert } from './lib/upsert.js'

export async function createConfigMap(configMap, statefulSetName) {
  const client = getKubernetesClient(servicesNamespace)
  return upsert({
    read: () =>
      client.readNamespacedConfigMap(statefulSetName, servicesNamespace),
    create: () =>
      client.createNamespacedConfigMap(servicesNamespace, configMap),
    update: () =>
      client.replaceNamespacedConfigMap(
        statefulSetName,
        servicesNamespace,
        configMap
      ),
  })
}
