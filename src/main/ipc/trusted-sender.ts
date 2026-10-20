import { parseUrl, WEB_PROTOCOLS, withoutHash } from '../url-compare'

export type TrustedSenderOptions = { rendererUrl: string | null; entryUrl: string }

function webOrigin(url: string | null): string | undefined {
  if (!url) return undefined
  const parsed = parseUrl(url)
  if (!parsed || !WEB_PROTOCOLS.has(parsed.protocol)) return undefined
  return parsed.origin
}

export function createTrustedSenderCheck({
  rendererUrl,
  entryUrl,
}: TrustedSenderOptions): (url: string | null) => boolean {
  const devOrigin = webOrigin(rendererUrl)
  const entryHref = withoutHash(new URL(entryUrl))

  return (url) => {
    if (!url) return false
    const parsed = parseUrl(url)
    if (!parsed) return false
    if (devOrigin) return parsed.origin === devOrigin
    return withoutHash(parsed) === entryHref
  }
}
