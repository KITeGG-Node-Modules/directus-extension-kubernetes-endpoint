import { createOrReplaceDeployment } from '../lib/operations/create-update-deployment.js'
import { parseErrorResponse, updateStatus } from '../lib/util.js'
import { removeDeployment } from '../lib/operations/remove-deployment.js'

export async function forwardToKubernetes(
  services,
  meta,
  context,
  handlerFunction
) {
  const { key, keys, collection } = meta
  let ids
  if (key && !keys) {
    ids = [key]
  } else {
    ids = keys
  }
  for (const id of ids) {
    let _status, _errors, object
    try {
      const { ItemsService } = services
      const service = new ItemsService(collection, {
        schema: context.schema,
        accountability: context.accountability,
      })
      object = await service.readOne(id)
    } catch {}
    try {
      _status = await handlerFunction(object || id)
      _errors = null
    } catch (err) {
      _status = null
      _errors = parseErrorResponse(err)
    }
    await updateStatus(services, context, collection, id, _status, _errors)
  }
}

export default ({ action }, { services }) => {
  action('k8s_deployments.items.create', async (meta, context) => {
    await forwardToKubernetes(
      services,
      meta,
      context,
      createOrReplaceDeployment
    )
  })

  action('k8s_deployments.items.update', async (meta, context) => {
    const k8sProps = ['containers', 'podName']
    const needsDeploy = Object.keys(meta.payload).reduce(
      (result, key) => result || k8sProps.includes(key),
      false
    )
    if (needsDeploy)
      await forwardToKubernetes(
        services,
        meta,
        context,
        createOrReplaceDeployment
      )
  })

  action('k8s_deployments.items.delete', async (meta, context) => {
    await forwardToKubernetes(services, meta, context, removeDeployment)
  })
}
