import { NAMESPACE_PREFIX, NAMESPACE_PREFIX_LENGTH } from '../variables.js'
import slugify from 'slugify'

export function getNamespace(namespace) {
  return `${NAMESPACE_PREFIX}${namespace}`
}

export function parseNamespace(namespace) {
  return namespace.slice(NAMESPACE_PREFIX_LENGTH)
}

export function getHostnameSlug(str) {
  if (!str || str.length === 0)
    throw new Error('Empty string supplied as hostname')
  return slugify(str.trim().replace(/^[^a-zA-Z]*|[^a-zA-Z0-9]*$/g, ''))
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
