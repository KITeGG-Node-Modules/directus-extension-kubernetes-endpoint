import { createOrReplaceDeployment } from '../lib/operations/create-replace-deployment.js'
import { forwardToKubernetes } from '../lib/util.js'
import { removeDeployment } from '../lib/operations/remove-deployment.js'
import { createOrReplaceService } from '../lib/operations/create-replace-service.js'
import { removeService } from '../lib/operations/remove-service.js'
import { createOrReplaceVolumeClaim } from '../lib/operations/create-replace-volume-claim.js'
import { removeVolumeClaim } from '../lib/operations/remove-volume-claim.js'
import { createOrReplaceSecret } from '../lib/operations/create-replace-secret.js'
import { removeSecret } from '../lib/operations/remove-secret.js'
import { createOrReplaceConfigMap } from '../lib/operations/create-replace-config-map.js'
import { removeConfigMap } from '../lib/operations/remove-config-map.js'

function genericAction(args, key, k8sProps, createFunc, removeFunc) {
  const [{ action }, { services }] = args

  action(`${key}.create`, async (meta, context) => {
    await forwardToKubernetes(services, meta, context, createFunc)
  })

  action(`${key}.update`, async (meta, context) => {
    const needsDeploy = Object.keys(meta.payload).reduce(
      (result, key) => result || k8sProps.includes(key),
      false
    )
    if (needsDeploy)
      await forwardToKubernetes(services, meta, context, createFunc)
  })

  action(`${key}.delete`, async (meta, context) => {
    await forwardToKubernetes(services, meta, context, removeFunc)
  })
}

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
