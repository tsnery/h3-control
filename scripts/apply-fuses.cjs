const { join } = require('node:path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

const EXECUTABLE_FILE_NAME = 'H3 Control.exe'

exports.default = async function applyFuses(context) {
  await flipFuses(join(context.appOutDir, EXECUTABLE_FILE_NAME), {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableCookieEncryption]: true,
  })
}
