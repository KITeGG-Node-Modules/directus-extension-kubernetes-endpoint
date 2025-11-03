import { getDeployment } from './get-deployment.js'
import { restartDeployment } from './restart-deployment.js'
import { getEvents } from './get-events.js'
import { getLogs } from './get-logs.js'
import { patchDeployment } from './patch-deployment.js'
import { deleteDeployment } from './delete-deployment.js'
import { deletePod } from './delete-pod.js'
import { putDeployment } from './put-deployment.js'
import { getConfig } from './get-config.js'
import { getSecret } from './get-secret.js'
import { putConfig } from './put-config.js'
import { putSecret } from './put-secret.js'

export function registerDeployments(router, context) {
  deleteDeployment(router, context)
  deletePod(router, context)
  getConfig(router, context)
  getDeployment(router, context)
  getEvents(router, context)
  getLogs(router, context)
  getSecret(router, context)
  patchDeployment(router, context)
  putConfig(router, context)
  putDeployment(router, context)
  putSecret(router, context)
  restartDeployment(router, context)
}
