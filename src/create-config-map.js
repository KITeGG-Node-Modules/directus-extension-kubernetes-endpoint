import { getKubernetesClient } from 'kitegg-directus-extension-common'
import { servicesNamespace } from './lib/config.js'

export async function createConfigMap(res, configMap, statefulSetName) {
  const client = getKubernetesClient(servicesNamespace)
  const { body: existing } = await client.listNamespacedConfigMap(
    servicesNamespace,
    undefined,
    undefined,
    undefined,
    `metadata.name=${statefulSetName}`
  )
  if (existing.items.length === 1) {
    await client.replaceNamespacedConfigMap(
      statefulSetName,
      servicesNamespace,
      configMap
    )
  } else {
    await client.createNamespacedConfigMap(servicesNamespace, configMap)
    res.status(201)
  }
}
