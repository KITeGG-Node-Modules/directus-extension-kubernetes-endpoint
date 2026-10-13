import k8s from '@kubernetes/client-node'
import { storageClassName } from './config.js'
import { APP_LABEL_KEY, NUMBER_UNITS } from './constants.js'
import { formatQuantity } from './quantity.js'

export function makeVolumeClaim(volume, statefulSetName) {
  const volumeClaim = new k8s.V1PersistentVolumeClaim()
  volumeClaim.metadata = new k8s.V1ObjectMeta()
  volumeClaim.metadata.name = volume.name
  // Label claims so they can be cleaned up when the deployment is deleted
  // (PVCs created from volume claim templates do not inherit labels)
  if (statefulSetName) {
    volumeClaim.metadata.labels = { [APP_LABEL_KEY]: statefulSetName }
  }
  volumeClaim.spec = new k8s.V1PersistentVolumeClaimSpec()
  volumeClaim.spec.storageClassName = storageClassName
  volumeClaim.spec.accessModes = [volume.type || 'ReadWriteOnce']
  volumeClaim.spec.resources = new k8s.V1ResourceRequirements()
  volumeClaim.spec.resources.requests = {
    storage:
      formatQuantity(volume.size, NUMBER_UNITS.volumeSize) ?? volume.size,
  }
  return volumeClaim
}
