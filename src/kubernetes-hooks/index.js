import { genericAction } from '../lib/util.js'

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

export default (...args) => {
  //
  // Deployments

  genericAction(
    args,
    'k8s_deployments.items',
    ['containers', 'podName'],
    createOrReplaceDeployment,
    removeDeployment
  )

  //
  // Services

  genericAction(
    args,
    'k8s_services.items',
    ['ports'],
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
