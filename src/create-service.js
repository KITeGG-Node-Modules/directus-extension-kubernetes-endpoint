import { getKubernetesClient } from './lib/get-kubernetes-client.js'
import k8s from '@kubernetes/client-node'
import { servicesNamespace } from './lib/config.js'
import { upsert } from './lib/upsert.js'

export async function createService(service, serviceName) {
  const client = getKubernetesClient(servicesNamespace)
  return upsert({
    read: () => client.readNamespacedService(serviceName, servicesNamespace),
    create: () => client.createNamespacedService(servicesNamespace, service),
    update: async () => {
      // Services must be patched rather than replaced: spec.clusterIP is
      // immutable and a full replace of an existing Service fails
      const options = {
        headers: {
          'Content-type': k8s.PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH,
        },
      }
      await client.patchNamespacedService(
        serviceName,
        servicesNamespace,
        { spec: { ports: service.spec.ports } },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        options
      )
    },
  })
}
