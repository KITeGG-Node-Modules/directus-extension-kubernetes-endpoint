import k8s from '@kubernetes/client-node'
import { genericMetadata } from '../util/k8s.js'

export function makeVolume(payload, userId) {
  const volume = new k8s.V1PersistentVolume()
  volume.metadata = genericMetadata(payload, userId)
  volume.spec = new k8s.V1PersistentVolumeSpec()
  volume.spec.storageClassName = 'longhorn'
  volume.spec.accessModes = [payload.mountType || 'ReadWriteOnce']
  volume.spec.capacity = payload.size
  return volume
}
