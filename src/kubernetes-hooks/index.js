import { genericAction, genericFilter } from '../lib/util/hooks.js'

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
import { validateService } from '../lib/validations/service.js'
import { validateVolume } from '../lib/validations/volume.js'
import { validateSecret } from '../lib/validations/secret.js'
import { validateDeployment } from '../lib/validations/deployment.js'

export default (...args) => {
  //
  // Deployments

  const DEPLOYMENT_K8S_PROPS = ['containers']
  genericFilter(
    args,
    'k8s_deployments.items',
    DEPLOYMENT_K8S_PROPS,
    validateDeployment
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

  const VOLUME_K8S_PROPS = ['size', 'mountType']
  genericFilter(args, 'k8s_volumes.items', VOLUME_K8S_PROPS, validateVolume)
  genericAction(
    args,
    'k8s_volumes.items',
    VOLUME_K8S_PROPS,
    createOrReplaceVolumeClaim,
    removeVolumeClaim
  )

  //
  // Secrets

  const SECRET_K8S_PROPS = ['data']
  genericFilter(args, 'k8s_secrets.items', SECRET_K8S_PROPS, validateSecret)
  genericAction(
    args,
    'k8s_secrets.items',
    SECRET_K8S_PROPS,
    createOrReplaceSecret,
    removeSecret
  )

  //
  // ConfigMaps

  const CONFIG_MAP_K8S_PROPS = ['data']
  genericFilter(args, 'k8s_configs.items', CONFIG_MAP_K8S_PROPS, validateSecret)
  genericAction(
    args,
    'k8s_configs.items',
    CONFIG_MAP_K8S_PROPS,
    createOrReplaceConfigMap,
    removeConfigMap
  )
}
