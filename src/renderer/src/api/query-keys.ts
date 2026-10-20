export const headsetKeys = {
  all: () => ['headset'] as const,
  snapshot: () => ['headset', 'snapshot'] as const,
}

export const volumeKeys = {
  current: () => ['volume', 'current'] as const,
}

export const preferencesKeys = {
  all: () => ['preferences'] as const,
}
