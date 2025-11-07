export const servicesNamespace = process.env.SERVICES_NAMESPACE || 'services'

export const LABEL_NAMESPACE = 'llp.kitegg.de'

export const API_VERSION = 'v2'
export const ROUTE_PREFIX = `/${API_VERSION}`

export const NAMESPACE_PREFIX = 'user-'
export const UUID_LENGTH = 36
export const NAMESPACE_PREFIX_FULL_LENGTH =
  NAMESPACE_PREFIX.length + UUID_LENGTH + 1
