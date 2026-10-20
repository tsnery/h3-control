const USER_DATA_ENV_NAME = 'QCY_USER_DATA_DIR'

export function resolveUserDataOverride(
  env: Record<string, string | undefined>,
  isPackaged: boolean,
): string | null {
  if (isPackaged) return null
  const directory = env[USER_DATA_ENV_NAME]
  return directory ? directory : null
}
