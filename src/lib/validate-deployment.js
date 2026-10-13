import validate from 'validate.js'
import { validateContainer } from './validate-container.js'
import { isSuffixedVolumeName } from './util.js'

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
          size: {
            type: 'string',
            format: {
              pattern: '^\\d{1,3}(?:Mi|Gi){1}$',
              message: 'must be one to three digits followed by Mi or Gi',
            },
          },
          'emptyDir.sizeLimit': {
            type: 'number',
            numericality: {
              strict: true,
              noStrings: true,
              lessThanOrEqualTo: 256,
            },
          },
        })
        if (volumeErrors) {
          validationErrors = validationErrors.concat(volumeErrors)
          continue
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
