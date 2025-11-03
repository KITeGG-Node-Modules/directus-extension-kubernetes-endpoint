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
    let _status, _errors
    try {
      const { ItemsService } = services
      const service = new ItemsService(collection, {
        schema: context.schema,
        accountability: context.accountability,
      })
      const object = await service.readOne(id)
      _status = await handlerFunction(object)
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
    if (!meta.payload._status && !meta.payload._errors) {
      await forwardToKubernetes(
        services,
        meta,
        context,
        createOrReplaceDeployment
      )
    }
  })

  action('k8s_deployments.items.delete', async (meta, context) => {
    await forwardToKubernetes(services, meta, context, removeDeployment)
  })
}
