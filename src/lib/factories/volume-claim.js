import k8s from '@kubernetes/client-node'
import { genericMetadata, LABEL_NAMESPACE } from '../util.js'
import { getKubernetesClient } from 'kitegg-directus-extension-common'

export function makeVolumeClaim(payload) {
  const volumeClaim = new k8s.V1PersistentVolumeClaim()
  volumeClaim.metadata = genericMetadata(payload)
  volumeClaim.spec = new k8s.V1PersistentVolumeClaimSpec()
  volumeClaim.spec.storageClassName = 'longhorn'
  volumeClaim.spec.accessModes = [payload.mountType || 'ReadWriteOnce']
  volumeClaim.spec.resources = new k8s.V1ResourceRequirements()
  volumeClaim.spec.resources.requests = {
    storage: payload.size,
  }
  return volumeClaim
}

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
