import { restartDeployment } from './restart-deployment.js'
import { getEvents } from './get-events.js'
import { getLogs } from './get-logs.js'
import { patchDeployment } from './patch-deployment.js'
import { getDeployment } from './get-deployment.js'

export function registerDeployments(router, context) {
  getDeployment(router, context)
  getEvents(router, context)
  getLogs(router, context)
  patchDeployment(router, context)
  restartDeployment(router, context)
}
