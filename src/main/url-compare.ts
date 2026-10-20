export const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

export function parseUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

export function withoutHash(url: URL): string {
  const copy = new URL(url)
  copy.hash = ''
  return copy.href
}
