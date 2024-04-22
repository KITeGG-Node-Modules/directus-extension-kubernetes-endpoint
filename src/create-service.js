import { getKubernetesClient } from 'kitegg-directus-extension-common'

export async function createService(res, service, serviceName) {
  const client = getKubernetesClient('services')
  const { body: existing } = await client.listNamespacedService(
    'services',
    undefined,
    undefined,
    undefined,
    `metadata.name=${serviceName}`
  )
  if (existing.items.length === 1) {
    await client.replaceNamespacedService(serviceName, 'services', service)
  } else {
    await client.createNamespacedService('services', service)
    res.status(201)
  }
}
