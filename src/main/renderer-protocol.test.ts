import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createRendererProtocolHandler,
  RENDERER_ENTRY_URL,
  RENDERER_SCHEME,
  RENDERER_SCHEME_PRIVILEGES,
} from './renderer-protocol'

const NOT_FOUND = 404
const OK = 200
const INDEX_HTML = '<!doctype html><title>QCY</title>'
const SECRET = 'outside the renderer directory'

const ASSETS_BY_CONTENT_TYPE = [
  ['assets/index.js', 'text/javascript; charset=utf-8'],
  ['assets/index.css', 'text/css; charset=utf-8'],
  ['assets/logo.png', 'image/png'],
  ['assets/logo.svg', 'image/svg+xml'],
  ['favicon.ico', 'image/x-icon'],
  ['assets/panel.json', 'application/json; charset=utf-8'],
  ['assets/font.woff2', 'font/woff2'],
  ['assets/font.woff', 'font/woff'],
  ['assets/blob.bin', 'application/octet-stream'],
  ['assets/UPPER.JS', 'text/javascript; charset=utf-8'],
] as const

let workDir = ''
let rendererDir = ''
let handle: (request: Request) => Promise<Response>

async function fetchUrl(url: string): Promise<Response> {
  return handle(new Request(url))
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'qcy-renderer-protocol-'))
  rendererDir = join(workDir, 'renderer')
  await mkdir(join(rendererDir, 'assets'), { recursive: true })
  await writeFile(join(rendererDir, 'index.html'), INDEX_HTML)
  await writeFile(join(workDir, 'secret.txt'), SECRET)
  await writeFile(join(workDir, 'renderer-evil.html'), SECRET)
  await Promise.all(ASSETS_BY_CONTENT_TYPE.map(([path]) => writeFile(join(rendererDir, path), path)))
  handle = createRendererProtocolHandler(rendererDir)
})

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true })
})

describe('renderer scheme registration', () => {
  it('serves the entry page from a standard, secure app origin', () => {
    expect(RENDERER_ENTRY_URL).toBe('app://renderer/index.html')
    expect(new URL(RENDERER_ENTRY_URL).protocol).toBe(`${RENDERER_SCHEME}:`)
    expect(RENDERER_SCHEME_PRIVILEGES).toMatchObject({ standard: true, secure: true, supportFetchAPI: true })
  })

  it('does not bypass CSP or open the scheme to CORS', () => {
    expect(RENDERER_SCHEME_PRIVILEGES).not.toHaveProperty('bypassCSP')
    expect(RENDERER_SCHEME_PRIVILEGES).not.toHaveProperty('corsEnabled')
  })
})

describe('createRendererProtocolHandler serving files', () => {
  it('serves the entry page as HTML', async () => {
    const response = await fetchUrl(RENDERER_ENTRY_URL)
    expect(response.status).toBe(OK)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await response.text()).toBe(INDEX_HTML)
  })

  it('ignores the query string and hash when mapping to a file', async () => {
    const response = await fetchUrl(`${RENDERER_ENTRY_URL}?v=1#/settings`)
    expect(response.status).toBe(OK)
    expect(await response.text()).toBe(INDEX_HTML)
  })

  it.each(ASSETS_BY_CONTENT_TYPE)('serves %s as %s', async (path, contentType) => {
    const response = await fetchUrl(`app://renderer/${path}`)
    expect(response.status).toBe(OK)
    expect(response.headers.get('content-type')).toBe(contentType)
    expect(await response.text()).toBe(path)
  })
})

describe('createRendererProtocolHandler rejecting requests', () => {
  it.each([
    ['a missing file', 'app://renderer/missing.js'],
    ['a directory', 'app://renderer/assets'],
    ['the bare origin', 'app://renderer/'],
    ['a different host', 'app://evil/index.html'],
    ['an upper-case host', 'app://RENDERER/index.html'],
    ['a different scheme', 'https://renderer/index.html'],
  ])('returns 404 for %s', async (_case, url) => {
    expect((await fetchUrl(url)).status).toBe(NOT_FOUND)
  })

  it.each([
    ['a plain dot-dot segment', 'app://renderer/../secret.txt'],
    ['an encoded dot-dot segment', 'app://renderer/%2e%2e/secret.txt'],
    ['an encoded slash after dot-dot', 'app://renderer/..%2fsecret.txt'],
    ['a fully encoded dot-dot-slash', 'app://renderer/%2e%2e%2fsecret.txt'],
    ['an encoded backslash after dot-dot', 'app://renderer/..%5csecret.txt'],
    ['a nested escape', 'app://renderer/assets/..%2f..%2fsecret.txt'],
    ['a sibling directory sharing the prefix', 'app://renderer/..%2frenderer-evil.html'],
    ['a malformed escape', 'app://renderer/%E0%A4%A'],
    ['a null byte', 'app://renderer/index.html%00.js'],
  ])('returns 404 for %s', async (_case, url) => {
    const response = await fetchUrl(url)
    expect(response.status).toBe(NOT_FOUND)
    expect(await response.text()).not.toContain(SECRET)
  })

  it('returns 404 for an absolute path to a file outside the renderer directory', async () => {
    const absoluteSecret = encodeURIComponent(join(workDir, 'secret.txt'))
    const response = await fetchUrl(`app://renderer/${absoluteSecret}`)
    expect(response.status).toBe(NOT_FOUND)
    expect(await response.text()).not.toContain(SECRET)
  })

  it('returns 404 for a double-slash absolute path', async () => {
    const forwardSlashSecret = join(workDir, 'secret.txt').replaceAll('\\', '/')
    const response = await fetchUrl(`app://renderer//${forwardSlashSecret}`)
    expect(response.status).toBe(NOT_FOUND)
    expect(await response.text()).not.toContain(SECRET)
  })
})
