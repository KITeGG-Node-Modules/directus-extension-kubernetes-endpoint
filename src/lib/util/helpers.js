import slugify from 'slugify'
import {
  NAMESPACE_PREFIX,
  NAMESPACE_PREFIX_FULL_LENGTH,
  UUID_LENGTH,
} from '../variables.js'

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

export function isSuffixedVolumeName(name) {
  const regex = new RegExp(
    '^.*-sd-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]+$'
  )
  return regex.test(name)
}

export function needsDeploy(payload, k8sProps) {
  return Object.keys(payload).reduce(
    (result, key) => result || k8sProps.includes(key),
    false
  )
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
