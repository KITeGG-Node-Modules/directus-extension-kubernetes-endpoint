import slugify from 'slugify'

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

const DIRECTUS_ERROR_KEYS = {
  FORBIDDEN: 'api_errors.forbidden',
  NOT_FOUND: 'api_errors.not_found',
  INVALID_PAYLOAD: 'api_errors.bad_request',
  INVALID_CREDENTIALS: 'api_errors.unauthorized',
}

/**
 * Map errors to a consistent JSON error response.
 *
 * Never leaks raw error text in `message`: clients receive an
 * api_errors.* translation key, with the original text (e.g. a
 * Kubernetes scheduling failure) in `detail` where it is useful.
 */
export function handleErrorResponse(res, err) {
  // Kubernetes client errors carry the API Status object in err.body
  if (err?.body?.code != null) {
    const status = err.body.code
    res.status(Number.isInteger(status) ? status : 500)
    return {
      message: 'api_errors.kubernetes_error',
      detail: err.body.message,
    }
  }
  // Directus service errors carry statusCode and extensions.code
  if (Number.isInteger(err?.statusCode)) {
    res.status(err.statusCode)
    return {
      message:
        DIRECTUS_ERROR_KEYS[err?.extensions?.code] ??
        'api_errors.internal_error',
      detail: err.message,
    }
  }
  console.error(err)
  res.status(500)
  return {
    message: 'api_errors.internal_error',
    detail: err?.message,
  }
}

export function isSuffixedVolumeName(name) {
  const regex = new RegExp(
    '^.*-sd-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]+$'
  )
  return regex.test(name)
}
