import * as k8s from '@kubernetes/client-node'

export default {
	id: 'kubernetes',
	handler: (router, context) => {
		router.get('/capacity', async (req, res) => {
			if (!req.accountability?.user) {
				console.log('Kubernetes: Anonymous rejected')
				res.status(401)
				return res.send({message: 'api_errors.unauthorized'})
			}
			try {
				const client = getClient()
				const response = await client.listNode()
				const podResponse = await client.listPodForAllNamespaces()
				const pods = podResponse.body.items
				const workers = response.body.items
					.filter(node => node.metadata.labels['node-role.kubernetes.io/worker'] === 'worker')
					.map(node => ({
						name: node.metadata.name,
						labels: node.metadata.labels,
						addresses: node.status.addresses,
						allocatable: node.status.allocatable,
						capacity: node.status.capacity,
						nodeInfo: node.status.nodeInfo
					}))
				for (const worker of workers) {
					// Overhead? https://github.com/kubernetes/kubectl/blob/master/pkg/util/resource/resource.go#L46
					worker.pods = pods.filter(pod => pod.spec.nodeName === worker.name)
					const containers = worker.pods.map(pod => pod.spec.containers).flat()
					worker.resources = {
						limits: {},
						requests: {}
					}
					for (const container of containers) {
						if (container.resources.limits && container.resources.requests) {
							for (const type in worker.resources) {
								for (const key in container.resources[type]) {
									let value = parseFloat(container.resources[type][key])
									if (worker.resources[type][key]) worker.resources[type][key] += value
									else worker.resources[type][key] = value
								}
							}
						}
					}
				}
        const results = []
        for (const worker of workers) {
          const result = { name: worker.name }
          result.available = {}
          for (const key in worker.allocatable) {
            if (key.startsWith('nvidia')) {
              result.available[key] = worker.allocatable[key]
            }
          }
          result.requested = {}
          for (const key in worker.resources.limits) {
            if (key.startsWith('nvidia')) {
              result.requested[key] = worker.resources.limits[key]
            }
          }
          results.push(result)
        }
				res.send(results)
			}
			catch (error) {
        console.error('Kubernetes error:', error.message)
				res.status(500)
			}
		})
	}
}

let _client
function getClient () {
	if (_client) return _client

	const kc = new k8s.KubeConfig()
	const cluster = {
		name: process.env.K8S_CLUSTER_NAME,
		server: process.env.K8S_CLUSTER_SERVER,
		skipTLSVerify: !!process.env.K8S_CLUSTER_SKIP_TLS || false
	}
	const user = {
		name: process.env.K8S_USER_NAME,
		token: process.env.K8S_USER_TOKEN
	}
	const context = {
		name: 'default',
		user: user.name,
		cluster: cluster.name,
		namespace: process.env.K8S_NAMESPACE
	}
	kc.loadFromOptions({
		clusters: [cluster],
		users: [user],
		contexts: [context],
		currentContext: context.name
	})

	_client = kc.makeApiClient(k8s.CoreV1Api)
	return _client
}
