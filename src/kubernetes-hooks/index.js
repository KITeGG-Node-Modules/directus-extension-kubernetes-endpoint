import { genericAction, genericFilter } from '../lib/util.js'

import {
  createOrReplaceDeployment,
  removeDeployment,
} from '../lib/operations/deployment.js'
import {
  createOrReplaceService,
  removeService,
} from '../lib/operations/service.js'
import {
  createOrReplaceVolumeClaim,
  removeVolumeClaim,
} from '../lib/operations/volume-claim.js'
import {
  createOrReplaceSecret,
  removeSecret,
} from '../lib/operations/secret.js'
import {
  createOrReplaceConfigMap,
  removeConfigMap,
} from '../lib/operations/config-map.js'
import { validateContainer } from '../lib/validations/container.js'
import { validateService } from '../lib/validations/service.js'

export default (...args) => {
  //
  // Deployments

  const DEPLOYMENT_K8S_PROPS = ['containers']
  genericFilter(
    args,
    'k8s_deployments.items',
    DEPLOYMENT_K8S_PROPS,
    (payload) => {
      let containerErrors = []
      for (const container of payload.containers) {
        containerErrors = containerErrors.concat(
          validateContainer(container) || []
        )
      }
      return containerErrors
    }
  )
  genericAction(
    args,
    'k8s_deployments.items',
    DEPLOYMENT_K8S_PROPS,
    createOrReplaceDeployment,
    removeDeployment
  )

  //
  // Services

  const SERVICE_K8S_PROPS = ['ports', 'port', 'protocol']
  genericFilter(args, 'k8s_services.items', SERVICE_K8S_PROPS, validateService)
  genericAction(
    args,
    'k8s_services.items',
    SERVICE_K8S_PROPS,
    createOrReplaceService,
    removeService
  )

  //
  // VolumeClaims

  genericAction(
    args,
    'k8s_volumes.items',
    ['size', 'mountType'],
    createOrReplaceVolumeClaim,
    removeVolumeClaim
  )

  //
  // Secrets

  genericAction(
    args,
    'k8s_secrets.items',
    ['data'],
    createOrReplaceSecret,
    removeSecret
  )

  //
  // ConfigMaps

  genericAction(
    args,
    'k8s_configs.items',
    ['data'],
    createOrReplaceConfigMap,
    removeConfigMap
  )
}
