import kubernetesHooks from './kubernetes-hooks/index.js'
import kubernetesEndpoint from './kubernetes-endpoint/index.js'

const hooks = [{ name: 'kubernetes-hooks', config: kubernetesHooks }]
const endpoints = [{ name: 'kubernetes-endpoint', config: kubernetesEndpoint }]
const operations = []

export { endpoints, hooks, operations }
