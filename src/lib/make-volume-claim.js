import k8s from '@kubernetes/client-node'

export function makeVolumeClaim(volume) {
  const volumeClaim = new k8s.V1PersistentVolumeClaim()
  volumeClaim.metadata = new k8s.V1ObjectMeta()
  volumeClaim.metadata.name = volume.name
  volumeClaim.spec = new k8s.V1PersistentVolumeClaimSpec()
  volumeClaim.spec.storageClassName = 'longhorn'
  volumeClaim.spec.accessModes = [volume.type || 'ReadWriteOnce']
  volumeClaim.spec.resources = new k8s.V1ResourceRequirements()
  volumeClaim.spec.resources.requests = {
    storage: volume.size,
  }
  return volumeClaim
}
