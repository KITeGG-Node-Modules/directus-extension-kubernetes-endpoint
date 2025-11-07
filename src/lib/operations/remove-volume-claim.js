import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { LABEL_NAMESPACE } from '../util.js'

export async function removeVolumeClaim(id, res = undefined) {
  const client = getKubernetesClient(undefined, k8s.CoreV1Api)
  const { body: existing } =
    await client.listPersistentVolumeClaimForAllNamespaces(
      undefined,
      undefined,
      undefined,
      `${LABEL_NAMESPACE}/objectId=${id}`
    )
  if (existing.items.length > 0) {
    for (const item of existing.items) {
      await client.deleteNamespacedPersistentVolumeClaim(
        item.metadata.name,
        item.metadata.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        'Background'
      )
    }
  }
  return { deleted: id }
}
