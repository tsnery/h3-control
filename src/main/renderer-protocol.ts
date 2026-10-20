import type { Privileges, Protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

export const RENDERER_SCHEME = 'app'
export const RENDERER_HOST = 'renderer'
export const RENDERER_ENTRY_URL = `${RENDERER_SCHEME}://${RENDERER_HOST}/index.html`

// Standard + secure gives the page a real origin, so the CSP's 'self' covers it without bypassCSP or corsEnabled.
export const RENDERER_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
} as const satisfies Privileges

const DEFAULT_CONTENT_TYPE = 'application/octet-stream'
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}

const NOT_FOUND_STATUS = 404
const PARENT_SEGMENT = '..'
const NULL_CHARACTER = '\0'

function contentTypeFor(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? DEFAULT_CONTENT_TYPE
}

function decodePath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return null
  }
}

function isInside(root: string, file: string): boolean {
  const fromRoot = relative(root, file)
  if (!fromRoot || isAbsolute(fromRoot)) return false
  return fromRoot.split(sep)[0] !== PARENT_SEGMENT
}

function resolveRendererFile(url: URL, root: string): string | null {
  if (url.protocol !== `${RENDERER_SCHEME}:` || url.host !== RENDERER_HOST) return null
  const requestedPath = decodePath(url.pathname.slice(1))
  if (!requestedPath || requestedPath.includes(NULL_CHARACTER) || isAbsolute(requestedPath)) return null
  const file = resolve(root, requestedPath)
  return isInside(root, file) ? file : null
}

function notFound(): Response {
  return new Response(null, { status: NOT_FOUND_STATUS })
}

export function createRendererProtocolHandler(rendererDir: string): (request: Request) => Promise<Response> {
  const root = resolve(rendererDir)

  return async (request) => {
    const file = resolveRendererFile(new URL(request.url), root)
    if (!file) return notFound()
    try {
      const body = await readFile(file)
      return new Response(body, {
        headers: { 'Content-Type': contentTypeFor(file), 'X-Content-Type-Options': 'nosniff' },
      })
    } catch {
      return notFound()
    }
  }
}

export function registerRendererScheme(protocol: Pick<Protocol, 'registerSchemesAsPrivileged'>): void {
  protocol.registerSchemesAsPrivileged([{ scheme: RENDERER_SCHEME, privileges: RENDERER_SCHEME_PRIVILEGES }])
}

export function serveRendererScheme(protocol: Pick<Protocol, 'handle'>, rendererDir: string): void {
  protocol.handle(RENDERER_SCHEME, createRendererProtocolHandler(rendererDir))
}
