import { getKubernetesClient } from './lib/get-kubernetes-client.js'
import { servicesNamespace } from './lib/config.js'
import { upsert } from './lib/upsert.js'

export async function createSecret(secret, statefulSetName) {
  const client = getKubernetesClient(servicesNamespace)
  return upsert({
    read: () => client.readNamespacedSecret(statefulSetName, servicesNamespace),
    create: () => client.createNamespacedSecret(servicesNamespace, secret),
    update: () =>
      client.replaceNamespacedSecret(
        statefulSetName,
        servicesNamespace,
        secret
      ),
  })
}
