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

export const NAMESPACE_PREFIX = 'user-'
export const UUID_LENGTH = 36
export const NAMESPACE_PREFIX_FULL_LENGTH =
  NAMESPACE_PREFIX.length + UUID_LENGTH + 1

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

export function isSuffixedVolumeName(name) {
  const regex = new RegExp(
    '^.*-sd-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]+$'
  )
  return regex.test(name)
}
