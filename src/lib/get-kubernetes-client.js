import k8s from '@kubernetes/client-node'

// Clients are cached per API class and namespace. The cache must be keyed on
// the API class object itself, not on its name: bundling strips class names,
// so every client-node API class ends up with an empty `.name` and a
// name-keyed cache would return the wrong client type (e.g. the AppsV1Api
// client when CoreV1Api was requested), blowing up with
// "TypeError: ... is not a function" at runtime.
const _clients = new WeakMap()

export function getKubeConfig(namespace = process.env.K8S_NAMESPACE) {
  const kc = new k8s.KubeConfig()
  const cluster = {
    name: process.env.K8S_CLUSTER_NAME,
    server: process.env.K8S_CLUSTER_SERVER,
    skipTLSVerify: !!process.env.K8S_CLUSTER_SKIP_TLS || false,
  }
  const user = {
    name: process.env.K8S_USER_NAME,
    token: process.env.K8S_USER_TOKEN,
  }
  const context = {
    name: 'default',
    user: user.name,
    cluster: cluster.name,
    namespace: namespace || process.env.K8S_NAMESPACE,
  }
  kc.loadFromOptions({
    clusters: [cluster],
    users: [user],
    contexts: [context],
    currentContext: context.name,
  })
  return kc
}

export function getKubernetesClient(
  namespace = process.env.K8S_NAMESPACE,
  api = k8s.CoreV1Api
) {
  let namespaceClients = _clients.get(api)
  if (!namespaceClients) {
    namespaceClients = new Map()
    _clients.set(api, namespaceClients)
  }
  let client = namespaceClients.get(namespace)
  if (!client) {
    client = getKubeConfig(namespace).makeApiClient(api)
    namespaceClients.set(namespace, client)
  }
  return client
}
