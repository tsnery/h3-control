import { resolve } from 'node:path'
import { createWindowsVolumeControl, spawnPowerShellVolumeHost } from '../src/main/volume/windows-volume'

const HOST_SCRIPT_PATH = resolve(__dirname, '../resources/volume-host.ps1')
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: pnpm tsx scripts/volume-check.ts get | set <percent>'

async function main(args: string[]): Promise<number> {
  const [command, argument] = args
  const control = createWindowsVolumeControl(() => spawnPowerShellVolumeHost(HOST_SCRIPT_PATH))
  try {
    if (command === 'get') {
      console.log(JSON.stringify(await control.get()))
      return 0
    }
    if (command === 'set' && argument !== undefined && argument.trim() !== '') {
      await control.set(Number(argument))
      console.log('ok')
      return 0
    }
    console.error(USAGE)
    return FAILURE_EXIT_CODE
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    return FAILURE_EXIT_CODE
  } finally {
    control.dispose()
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code
})
