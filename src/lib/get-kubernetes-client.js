// SPDX-License-Identifier: EUPL-1.2
// Re-export from the shared kitegg-directus-extension-common package — the
// canonical implementation (bundle-safe class-object-keyed client cache,
// strict configuration errors) lives there. This shim keeps the existing
// relative import sites across the extension untouched.
export {
  getKubeConfig,
  getKubernetesClient,
} from 'kitegg-directus-extension-common'
