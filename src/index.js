import { baseRequestHandler } from 'kitegg-directus-extension-common'
import { backfillNetworkPoliciesRoute } from './endpoints/backfill-network-policies.js'
import { getCapacity } from './endpoints/capacity.js'
import { getDeployment } from './endpoints/get-deployment.js'
import { getDeploymentsState } from './endpoints/get-deployments-state.js'
import { restartDeployment } from './endpoints/restart-deployment.js'
import { getPodLogs } from './endpoints/get-pod-logs.js'
import { getDeploymentPodEvents } from './endpoints/get-pod-events.js'
import { scaleDeployment } from './endpoints/scale-deployment.js'
import { deleteDeploymentRoute } from './endpoints/delete-deployment.js'
import { deleteDeploymentPod } from './endpoints/delete-pod.js'
import { deployDeployment } from './endpoints/deploy-deployment.js'
import { putDeploymentSecret } from './endpoints/put-secret.js'
import { getDeploymentSecret } from './endpoints/get-secret.js'
import { putDeploymentConfig } from './endpoints/put-config.js'
import { getDeploymentConfig } from './endpoints/get-config.js'

export default {
  id: 'kubernetes',
  handler: (router, context) => {
    router.get('/capacity', baseRequestHandler(getCapacity, context))

    router.post(
      '/network-policies/backfill',
      baseRequestHandler(backfillNetworkPoliciesRoute, context)
    )

    router.get('/deployments/:id', baseRequestHandler(getDeployment, context))

    router.get(
      '/deployments-running',
      baseRequestHandler(getDeploymentsState, context)
    )

    router.post(
      '/deployments/:id/hooks/restart',
      baseRequestHandler(restartDeployment, context)
    )

    router.get(
      '/deployments/:id/logs/:podName',
      baseRequestHandler(getPodLogs, context)
    )

    router.get(
      '/deployments/:id/events/:podName',
      baseRequestHandler(getDeploymentPodEvents, context)
    )

    router.patch(
      '/deployments/:id',
      baseRequestHandler(scaleDeployment, context)
    )

    router.delete(
      '/deployments/:id',
      baseRequestHandler(deleteDeploymentRoute, context)
    )

    router.delete(
      '/deployments/:id/pods/:podName',
      baseRequestHandler(deleteDeploymentPod, context)
    )

    router.put(
      '/deployments/:id',
      baseRequestHandler(deployDeployment, context)
    )

    router.put(
      '/deployments/:id/secret',
      baseRequestHandler(putDeploymentSecret, context)
    )

    router.get(
      '/deployments/:id/secret',
      baseRequestHandler(getDeploymentSecret, context)
    )

    router.put(
      '/deployments/:id/config',
      baseRequestHandler(putDeploymentConfig, context)
    )

    router.get(
      '/deployments/:id/config',
      baseRequestHandler(getDeploymentConfig, context)
    )
  },
}
