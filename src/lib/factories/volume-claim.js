import k8s from '@kubernetes/client-node'
import { genericMetadata } from '../util/k8s.js'

export function makeVolumeClaim(payload, userId) {
  const volumeClaim = new k8s.V1PersistentVolumeClaim()
  volumeClaim.metadata = genericMetadata(payload, userId)
  volumeClaim.spec = new k8s.V1PersistentVolumeClaimSpec()
  volumeClaim.spec.storageClassName = 'longhorn'
  volumeClaim.spec.accessModes = [payload.mountType || 'ReadWriteOnce']
  volumeClaim.spec.resources = new k8s.V1ResourceRequirements()
  volumeClaim.spec.resources.requests = {
    storage: payload.size,
  }
  return volumeClaim
}
