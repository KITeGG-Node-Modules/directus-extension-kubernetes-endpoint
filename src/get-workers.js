import { getKubernetesClient } from 'kitegg-directus-extension-common'

export async function getWorkers() {
    const client = getKubernetesClient()
    const response = await client.listNode()
    const podResponse = await client.listPodForAllNamespaces()
    const pods = podResponse.body.items
    const workers = response.body.items
        .filter(
            (node) =>
                node.metadata.labels['node-role.kubernetes.io/worker'] ===
                'worker'
        )
        .map((node) => ({
            name: node.metadata.name,
            labels: node.metadata.labels,
            addresses: node.status.addresses,
            allocatable: node.status.allocatable,
            capacity: node.status.capacity,
            nodeInfo: node.status.nodeInfo,
        }))
    for (const worker of workers) {
        // Overhead? https://github.com/kubernetes/kubectl/blob/master/pkg/util/resource/resource.go#L46
        worker.pods = pods.filter((pod) => pod.spec.nodeName === worker.name)
        const containers = worker.pods.map((pod) => pod.spec.containers).flat()
        worker.resources = {
            limits: {},
            requests: {},
        }
        for (const container of containers) {
            if (container.resources.limits && container.resources.requests) {
                for (const type in worker.resources) {
                    for (const key in container.resources[type]) {
                        let value = parseFloat(container.resources[type][key])
                        if (worker.resources[type][key])
                            worker.resources[type][key] += value
                        else worker.resources[type][key] = value
                    }
                }
            }
        }
    }
    return workers
}
