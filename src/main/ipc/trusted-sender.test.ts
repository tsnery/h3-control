import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { RENDERER_ENTRY_URL } from '../renderer-protocol'
import { createTrustedSenderCheck } from './trusted-sender'

const RENDERER_FILE = 'C:\\Program Files\\QCY H3\\resources\\app.asar\\out\\renderer\\index.html'
const FILE_URL = pathToFileURL(RENDERER_FILE).href
const DEV_URL = 'http://localhost:5173/'

describe('createTrustedSenderCheck without a dev server', () => {
  const isTrusted = createTrustedSenderCheck({ rendererUrl: null, entryUrl: RENDERER_ENTRY_URL })

  it('trusts the exact app entry URL', () => {
    expect(isTrusted(RENDERER_ENTRY_URL)).toBe(true)
  })

  it('trusts the entry URL with a hash', () => {
    expect(isTrusted(`${RENDERER_ENTRY_URL}#/settings`)).toBe(true)
  })

  it('rejects the entry URL with a query string', () => {
    expect(isTrusted(`${RENDERER_ENTRY_URL}?injected=1`)).toBe(false)
  })

  it('rejects other pages on the app origin, including a sibling path prefix', () => {
    expect(isTrusted('app://renderer/')).toBe(false)
    expect(isTrusted('app://renderer/assets/index.js')).toBe(false)
    expect(isTrusted(`${RENDERER_ENTRY_URL}.evil.html`)).toBe(false)
  })

  it('rejects lookalike app origins', () => {
    expect(isTrusted('app://evil/index.html')).toBe(false)
    expect(isTrusted('app://renderer.evil/index.html')).toBe(false)
    expect(isTrusted('app://renderer:8080/index.html')).toBe(false)
    expect(isTrusted('apps://renderer/index.html')).toBe(false)
  })

  it('rejects the renderer file URL now that it is served from the app scheme', () => {
    expect(isTrusted(FILE_URL)).toBe(false)
  })

  it('rejects web origins', () => {
    expect(isTrusted('https://example.com/')).toBe(false)
  })

  it('rejects null, empty and malformed URLs', () => {
    expect(isTrusted(null)).toBe(false)
    expect(isTrusted('')).toBe(false)
    expect(isTrusted('not a url')).toBe(false)
  })
})

describe('createTrustedSenderCheck in development', () => {
  const isTrusted = createTrustedSenderCheck({ rendererUrl: DEV_URL, entryUrl: RENDERER_ENTRY_URL })

  it('trusts any path on the dev server origin', () => {
    expect(isTrusted(DEV_URL)).toBe(true)
    expect(isTrusted('http://localhost:5173/index.html?x=1#a')).toBe(true)
  })

  it('rejects lookalike origins', () => {
    expect(isTrusted('http://localhost:5173.evil.com/')).toBe(false)
    expect(isTrusted('http://localhost:5174/')).toBe(false)
    expect(isTrusted('https://localhost:5173/')).toBe(false)
    expect(isTrusted('http://localhost@evil.com:5173/')).toBe(false)
  })

  it('rejects the app entry URL and null', () => {
    expect(isTrusted(RENDERER_ENTRY_URL)).toBe(false)
    expect(isTrusted(null)).toBe(false)
  })
})

describe('createTrustedSenderCheck with a non-web rendererUrl', () => {
  it.each(['file:///C:/evil/index.html', 'data:text/html,<p>x</p>', 'about:blank'])(
    'falls back to the app entry URL and trusts no null-origin sender for %s',
    (rendererUrl) => {
      const isTrusted = createTrustedSenderCheck({ rendererUrl, entryUrl: RENDERER_ENTRY_URL })
      expect(isTrusted(RENDERER_ENTRY_URL)).toBe(true)
      expect(isTrusted('file:///C:/evil/index.html')).toBe(false)
      expect(isTrusted('data:text/html,<p>x</p>')).toBe(false)
      expect(isTrusted('about:blank')).toBe(false)
    },
  )
})
