import slugify from 'slugify'
import k8s from '@kubernetes/client-node'
import {
  LABEL_NAMESPACE,
  NAMESPACE_PREFIX,
  NAMESPACE_PREFIX_FULL_LENGTH,
  UUID_LENGTH,
} from './config.js'

export function getNameSlug(name) {
  return slugify(name, {
    replacement: '-',
    lower: true,
    strict: true,
    trim: true,
  })
}

export function getDeploymentName(user, name) {
  const nameSlug = getNameSlug(name)
  return `sd-${nameSlug}`
}

export function getNamespace(user, namespace) {
  return `user-${user.id}-${namespace}`
}

export function parseNamespace(namespace) {
  return {
    user: namespace.slice(NAMESPACE_PREFIX.length, UUID_LENGTH),
    name: namespace.slice(NAMESPACE_PREFIX_FULL_LENGTH),
  }
}

export function handleErrorResponse(res, err) {
  if (err.body) {
    res.status(err.body.code)
    return err.body.message
  }
  console.error(err)
  res.status(500)
  return err.message
}

export function parseErrorResponse(err) {
  console.error(err)
  if (err.body) return err.body
  return { message: err.message }
}

export function isSuffixedVolumeName(name) {
  const regex = new RegExp(
    '^.*-sd-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]+$'
  )
  return regex.test(name)
}

export function genericMetadata(payload) {
  const metadata = new k8s.V1ObjectMeta()
  metadata.name = payload.name
  metadata.namespace = payload.namespace
  metadata.labels = {
    [`${LABEL_NAMESPACE}/objectId`]: payload.id,
    [`${LABEL_NAMESPACE}/userId`]: payload.user_created,
  }
  return metadata
}

export function genericAction(args, key, k8sProps, createFunc, removeFunc) {
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

export async function updateStatus(
  services,
  context,
  collection,
  key,
  _status,
  _errors
) {
  try {
    const { ItemsService } = services
    const deploymentsService = new ItemsService(collection, {
      schema: context.schema,
      accountability: context.accountability,
    })
    const payload = {
      _status: _status ? JSON.stringify(_status) : null,
      _errors: _errors ? JSON.stringify(_errors) : null,
    }
    await deploymentsService.updateOne(key, payload)
  } catch (err) {
    console.error('Failed to update status for', collection, key, err.message)
  }
}

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
