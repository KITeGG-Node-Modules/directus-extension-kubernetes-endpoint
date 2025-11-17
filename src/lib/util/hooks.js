import { createError } from '@directus/errors'
import { getHostnameSlug, needsDeploy } from './helpers.js'
import { checkForNamespaceChange, forwardToKubernetes } from './k8s.js'

export async function genericValidation(payload, validateFunc) {
  const result = await validateFunc(payload)
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

export function genericFilter(
  args,
  key,
  k8sKey,
  k8sProps,
  validateFunc,
  blockUpdate = false
) {
  const [{ filter }, { services }] = args

  filter(`${key}.create`, async (payload) => {
    if (payload.metaDisplayName) {
      payload.name = getHostnameSlug(payload.metaDisplayName)
    }
    if (needsDeploy(payload, k8sProps)) {
      try {
        await genericValidation(payload, validateFunc)
      } catch (error) {
        console.error('Validation error for create', key, error.message)
        const CreateError = createError(
          'BAD_REQUEST',
          'api_errors.validation_internal_error',
          400
        )
        throw new CreateError()
      }
    }
  })

  filter(`${key}.update`, async (payload, meta, context) => {
    if (payload.metaDisplayName) {
      payload.name = getHostnameSlug(payload.metaDisplayName)
    }
    if (needsDeploy(payload, k8sProps)) {
      if (blockUpdate) {
        const CreateError = createError(
          'BAD_REQUEST',
          'api_errors.no_update_allowed',
          400
        )
        throw new CreateError()
      }
      try {
        await genericValidation(payload, validateFunc)
      } catch (error) {
        console.error('Validation error for update', key, error.message)
        const CreateError = createError(
          'BAD_REQUEST',
          'api_errors.validation_internal_error',
          400
        )
        throw new CreateError()
      }
      await checkForNamespaceChange(
        { payload, meta, context, services },
        key.split('.').shift(),
        k8sKey
      )
    }
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
