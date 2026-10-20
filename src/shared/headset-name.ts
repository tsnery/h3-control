export const HEADSET_NAME_MAX_BYTES = 31

const encoder = new TextEncoder()

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length
}

export type HeadsetNameValidation =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'empty' | 'too-long' }

export function validateHeadsetName(name: string): HeadsetNameValidation {
  const trimmed = name.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  const bytes = encoder.encode(trimmed)
  if (utf8ByteLength(trimmed) > HEADSET_NAME_MAX_BYTES) return { ok: false, reason: 'too-long' }
  return { ok: true, bytes }
}
