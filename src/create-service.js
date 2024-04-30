import { getKubernetesClient } from 'kitegg-directus-extension-common'
import { servicesNamespace } from './lib/config.js'

export async function createService(res, service, serviceName) {
  const client = getKubernetesClient(servicesNamespace)
  const { body: existing } = await client.listNamespacedService(
    servicesNamespace,
    undefined,
    undefined,
    undefined,
    `metadata.name=${serviceName}`
  )
  if (existing.items.length === 1) {
    await client.replaceNamespacedService(
      serviceName,
      servicesNamespace,
      service
    )
  } else {
    await client.createNamespacedService(servicesNamespace, service)
    res.status(201)
  }
}
