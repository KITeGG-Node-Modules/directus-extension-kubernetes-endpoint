import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { servicesNamespace } from './lib/config.js'

export async function createSecret(res, secret, statefulSetName) {
  const client = getKubernetesClient(servicesNamespace)
  const { body: existing } = await client.listNamespacedSecret(
    servicesNamespace,
    undefined,
    undefined,
    undefined,
    `metadata.name=${statefulSetName}`
  )
  if (existing.items.length === 1) {
    await client.replaceNamespacedSecret(
      statefulSetName,
      servicesNamespace,
      secret
    )
  } else {
    await client.createNamespacedSecret(servicesNamespace, secret)
    res.status(201)
  }
}
