import { registerDeployments } from './deployments/index.js'
import { registerStatistics } from './statistics/index.js'

export default {
  id: 'kubernetes',
  handler: (router, context) => {
    registerStatistics(router, context)
    registerDeployments(router, context)
  },
}
