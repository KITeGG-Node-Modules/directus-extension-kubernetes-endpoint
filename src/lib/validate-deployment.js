import validate from 'validate.js'
import { NUMBER_UNITS } from './constants.js'
import { validateContainer } from './validate-container.js'
import { formatQuantity, parseQuantity } from './quantity.js'
import { isSuffixedVolumeName } from './util.js'

const GIB = 1024 ** 3
const MIB = 1024 ** 2
const MAX_VOLUME_SIZE = 999 * GIB
const MAX_EMPTY_DIR_SIZE = 256 * MIB
// Volume sizes: plain numbers (and numeric strings) count as GiB, anything
// else must be an explicit Mi or Gi quantity — larger units would silently
// grow the requested claim
const VOLUME_SIZE_PATTERN = /^-?\d+(?:\.\d+)?(Mi|Gi)?$/

const RFC1123_PATTERN =
  '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*'

export function validateDeployment(deployment, userGroups = []) {
  let validationErrors = []
  const topLevelErrors = validate(deployment, {
    containers: {
      presence: true,
      type: 'array',
    },
    initContainers: {
      type: 'array',
    },
    replicas: {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
        lessThanOrEqualTo: 16,
      },
    },
    podManagementPolicy: {
      type: 'string',
      inclusion: ['OrderedReady', 'Parallel'],
    },
    restartPolicy: {
      type: 'string',
      inclusion: ['Always', 'OnFailure', 'Never'],
    },
  })
  if (topLevelErrors) {
    validationErrors = validationErrors.concat(topLevelErrors)
    return validationErrors
  }

  // validate.js' presence check only rejects missing values
  if (deployment.containers.length === 0) {
    return [{ containers: ["Containers can't be blank"] }]
  }

  // Pod-level filesystem ownership can only be set once; containers
  // disagreeing on fsUser/fsGroup would silently apply the last value
  const allContainers = [
    ...deployment.containers,
    ...(deployment.initContainers || []),
  ]
  const fsUsers = new Set(
    allContainers.map((c) => c.fsUser).filter((v) => v != null)
  )
  const fsGroups = new Set(
    allContainers.map((c) => c.fsGroup).filter((v) => v != null)
  )
  if (fsUsers.size > 1) {
    validationErrors.push({
      containers: ['fsUser must be the same for all containers'],
    })
  }
  if (fsGroups.size > 1) {
    validationErrors.push({
      containers: ['fsGroup must be the same for all containers'],
    })
  }

  if (Array.isArray(deployment.initContainers)) {
    for (const container of deployment.initContainers) {
      const containerErrors = validateContainer(container, [], userGroups)
      if (containerErrors && containerErrors.length) {
        validationErrors = validationErrors.concat(containerErrors)
        return validationErrors
      }
    }
  }

  for (const container of deployment.containers) {
    const containerErrors = validateContainer(container, [], userGroups)
    if (containerErrors && containerErrors.length) {
      validationErrors = validationErrors.concat(containerErrors)
      return validationErrors
    }
  }

  if (deployment.volumes) {
    if (!Array.isArray(deployment.volumes)) {
      validationErrors.push({ volumes: ['must be an array'] })
    } else {
      const volumeNames = new Set()
      for (const volume of deployment.volumes) {
        const volumeErrors = validate(volume, {
          name: {
            presence: true,
            type: 'string',
            format: {
              pattern: RFC1123_PATTERN,
              message:
                'of volume must be a lowercase RFC1123 hostname (a-z,0-9,-,.)',
            },
          },
          // size and emptyDir.sizeLimit are validated below: they may be
          // numbers (in NUMBER_UNITS units) or Kubernetes quantity strings,
          // which validate.js' single-type rules cannot express
        })
        if (volumeErrors) {
          validationErrors = validationErrors.concat(volumeErrors)
          continue
        }

        // Capacity values may be numbers (interpreted in NUMBER_UNITS) or
        // Kubernetes quantity strings; both are bounds-checked in bytes
        if (volume.size != null) {
          const isKnownUnit =
            typeof volume.size === 'number' ||
            (typeof volume.size === 'string' &&
              VOLUME_SIZE_PATTERN.test(volume.size.trim()))
          const bytes = parseQuantity(
            formatQuantity(volume.size, NUMBER_UNITS.volumeSize)
          )
          if (
            !isKnownUnit ||
            bytes == null ||
            bytes < MIB ||
            bytes > MAX_VOLUME_SIZE
          ) {
            validationErrors.push({
              volumes: [
                `'${volume.name}' size must be between 1Mi and 999Gi (a number of Gi or an Mi/Gi quantity)`,
              ],
            })
          }
        }
        const emptyDirSizeLimit = volume.emptyDir?.sizeLimit
        if (emptyDirSizeLimit != null) {
          const bytes = parseQuantity(
            formatQuantity(emptyDirSizeLimit, NUMBER_UNITS.emptyDirSize)
          )
          if (bytes == null || bytes <= 0 || bytes > MAX_EMPTY_DIR_SIZE) {
            validationErrors.push({
              volumes: [
                `'${volume.name}' emptyDir.sizeLimit must be a positive number of Mi or a quantity up to 256Mi`,
              ],
            })
          }
        }
        // Volumes that make-stateful-set would silently drop: they need
        // to either reference an existing (suffixed) claim, become a
        // claim template (size) or be an in-memory emptyDir
        if (
          !volume.size &&
          !volume.emptyDir?.sizeLimit &&
          !isSuffixedVolumeName(volume.name)
        ) {
          validationErrors.push({
            volumes: [`'${volume.name}' needs a size or an emptyDir.sizeLimit`],
          })
        }
        volumeNames.add(volume.name)
      }

      // Mounts referencing undeclared volumes fail scheduling with an
      // opaque Kubernetes error; reject them early
      const mountChecks = [
        ['containers', deployment.containers],
        ['initContainers', deployment.initContainers || []],
      ]
      for (const [attribute, containers] of mountChecks) {
        for (const container of containers) {
          for (const mount of container.volumeMounts || []) {
            if (mount.name && !volumeNames.has(mount.name)) {
              validationErrors.push({
                [attribute]: [
                  `volume mount '${mount.name}' has no matching volume`,
                ],
              })
            }
          }
        }
      }
    }
  }

  if (validationErrors.length) return validationErrors
}
