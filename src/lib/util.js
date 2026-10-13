import slugify from 'slugify'
import { parse } from 'yaml'
import { MAX_REPLICAS } from './constants.js'

const VOLUME_SUFFIX_PATTERN =
  /^.*-sd-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]+$/

export function getNameSlug(name) {
  return slugify(name, {
    replacement: '-',
    lower: true,
    strict: true,
    trim: true,
  })
}

export function getDeploymentName(name) {
  // Directus ids may be numeric; slugify requires a string
  const nameSlug = getNameSlug(String(name))
  return `sd-${nameSlug}`
}

/**
 * Parse the deployment's YAML data, mapping parse failures to a
 * client-facing 400 error instead of an unhandled 500.
 */
export function parseDeploymentData(deployment) {
  try {
    return parse(deployment?.data)
  } catch (err) {
    const error = new Error(`Invalid deployment data: ${err.message}`)
    error.statusCode = 400
    error.extensions = { code: 'INVALID_PAYLOAD' }
    throw error
  }
}

/**
 * Parse a ?scale= query value, returning an integer within the allowed
 * replica bounds, or null when the value is not a valid scale.
 */
export function parseScale(value) {
  if (!/^\d+$/.test(String(value ?? ''))) return null
  const scale = parseInt(value, 10)
  if (scale < 0 || scale > MAX_REPLICAS) return null
  return scale
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
    detail: err?.message ?? err?.body?.message,
  }
}

export function isSuffixedVolumeName(name) {
  // Names of existing volume claims restored for a deployment:
  // <name>-sd-<uuid>-<ordinal>
  return VOLUME_SUFFIX_PATTERN.test(name)
}
