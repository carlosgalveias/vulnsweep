/**
 * IPC Channel Obfuscation Map
 *
 * Maps human-readable IPC channel names to opaque hex identifiers.
 * Used ONLY by the build pipeline (build-main.js) for post-bundle string replacement.
 *
 * WARNING: These values are baked into production builds. Changing a value
 * after release will break IPC communication between mismatched main/preload versions.
 * NEVER change existing mappings — only ADD new ones.
 */
export const IPC_CHANNEL_MAP = {
  // Request-Response channels (ipcMain.handle / ipcRenderer.invoke)
  'select-folder': '0x7A3F1D8E',
  'discover-projects': '0x4E2C9B71',
  'prepare-repository': '0xB8D14A63',
  'commit-and-push': '0x1F6E3C92',
  'analyze-project': '0xA5D087B4',
  'analyze-projects': '0x63F2E1A9',
  'scan-project': '0xD9174B5C',
  'scan-projects': '0x82A6F3DE',
  'scan:cancel': '0x3C8B21F7',
  'get-scan-settings': '0xE7490DA6',
  'apply-fixes': '0x5B1C8E4F',
  'scan-dep-updates': '0x9F6A72D1',
  'apply-dep-updates': '0x2D8E4B96',
  'license:scan': '0xC4F31A7E',
  'sbom:get-save-path': '0x16D9E5B3',
  'sbom:export': '0x8A2F6C41',
  'increment-trial-fix': '0xF1B73D28',
  'get-trial-status': '0x47E9A1C5',
  'set-analytics-opt-out': '0xBC5D2F84',
  'get-analytics-opt-out': '0x6A1E8D37',
  'credentials:set': '0xD3F4916B',
  'credentials:delete': '0x29C7E5A0',
  'credentials:getStatus': '0x9E3B18D4',
  'settings:get': '0x51A4F7C2',
  'settings:set': '0x0D6B9238',
  'get-commercial-status': '0xE82A4F1D',
  'activate-license': '0x74C6D3B9',
  'get-install-info': '0x3F917E4A',
  'get-active-price': '0xAB5D21C8',
  'open-payment-window': '0x68E4B7F3',
  'verify-and-activate': '0x1C9F5A2E',
  'seed-dev-transaction': '0xB42D81F6',
  'get-app-version': '0x5E7C3A94',
  'open-local-doc': '0xC18F6D27',
  'license-backup': '0x93A2E4B1',
  'license-restore': '0x2F8D17C6',
  'cache:getStats': '0xDA64B92E',
  'cache:clear': '0x461F8A5D',
  'get-dependency-paths': '0xF7C23E19',

  // Push-event channels (webContents.send / ipcRenderer.on)
  'log-message': '0x85B6D4A3',
  'splash:data': '0x3A19F7CE',
  'analysis-progress': '0xEC4D2187',
  'scan-progress': '0x7182AF5B',
  'dep-update-progress': '0x0B9E63D4',
};
