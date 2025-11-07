import k8s from '@kubernetes/client-node'
import { genericMetadata } from '../util.js'

export function makeVolume(payload) {
  const volume = new k8s.V1PersistentVolume()
  volume.metadata = genericMetadata(payload)
  volume.spec = new k8s.V1PersistentVolumeSpec()
  volume.spec.storageClassName = 'longhorn'
  volume.spec.accessModes = [payload.mountType || 'ReadWriteOnce']
  volume.spec.capacity = payload.size
  return volume
}
