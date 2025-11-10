import slugify from 'slugify'
import k8s from '@kubernetes/client-node'
import {
  LABEL_NAMESPACE,
  NAMESPACE_PREFIX,
  NAMESPACE_PREFIX_FULL_LENGTH,
  UUID_LENGTH,
} from './variables.js'
import { createError } from '@directus/errors'

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

export function getNamespace(userId, namespace) {
  return `${NAMESPACE_PREFIX}${userId}-${namespace}`
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

export function genericMetadata(payload, userId) {
  const metadata = new k8s.V1ObjectMeta()
  metadata.name = payload.name
  if (userId && payload.namespace)
    metadata.namespace = getNamespace(userId, payload.namespace)
  const labels = {}
  if (userId) labels[`${LABEL_NAMESPACE}/userId`] = userId
  if (payload.id) labels[`${LABEL_NAMESPACE}/objectId`] = payload.id
  if (payload.user_created)
    labels[`${LABEL_NAMESPACE}/creatorId`] = payload.user_created
  metadata.labels = labels
  return metadata
}

export function needsDeploy(payload, k8sProps) {
  return Object.keys(payload).reduce(
    (result, key) => result || k8sProps.includes(key),
    false
  )
}

export function genericValidation(payload, validateFunc) {
  const result = validateFunc(payload)
  if (result && result.length > 0) {
    const errors = result
      .reduce((acc, curr) => {
        acc.push(
          Object.keys(curr)
            .map((key) => `${key}: ${curr[key]}`)
            .join(', ')
        )
        return acc
      }, [])
      .join('; ')
    const message = `Validation failed: ${errors}`
    const CreateError = createError('BAD_REQUEST', message, 400)
    throw new CreateError()
  }
}

export function genericAction(args, key, k8sProps, createFunc, removeFunc) {
  const [{ action }, { services }] = args

  action(`${key}.create`, async (meta, context) => {
    if (needsDeploy(meta.payload, k8sProps))
      await forwardToKubernetes(services, meta, context, createFunc)
  })

  action(`${key}.update`, async (meta, context) => {
    if (needsDeploy(meta.payload, k8sProps))
      await forwardToKubernetes(services, meta, context, createFunc)
  })

  action(`${key}.delete`, async (meta, context) => {
    await forwardToKubernetes(services, meta, context, removeFunc)
  })
}

export function genericFilter(args, key, k8sProps, validateFunc) {
  const [{ filter }] = args

  filter(`${key}.create`, async (payload) => {
    if (needsDeploy(payload, k8sProps)) genericValidation(payload, validateFunc)
  })

  filter(`${key}.update`, async (payload) => {
    if (needsDeploy(payload, k8sProps)) genericValidation(payload, validateFunc)
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
    // TODO: Mask the full namespace in _status and _errors
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
  const { schema, accountability } = context
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
        schema,
        accountability,
      })
      object = await service.readOne(id)
    } catch {}
    try {
      _status = await handlerFunction(object || id, accountability.user)
      _errors = null
    } catch (err) {
      _status = null
      _errors = parseErrorResponse(err)
    }
    await updateStatus(services, context, collection, id, _status, _errors)
  }
}
