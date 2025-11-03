import { registerDeployments } from './deployments/index.js'
import { registerStatistics } from './statistics/index.js'
import { registerNamespaces } from './namespaces/index.js'

export default {
  id: 'kubernetes',
  handler: (router, context) => {
    registerStatistics(router, context)
    registerDeployments(router, context)
    registerNamespaces(router, context)
  },
}
