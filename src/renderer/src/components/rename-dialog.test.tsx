import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { HeadsetSnapshot } from '../../../shared/headset-types'
import { IpcErrorCode } from '../../../shared/ipc-contract'
import { App } from '../app'
import { COPY } from '../copy/pt-br'
import { createFakeBridge } from '../test/fake-bridge'

const CONNECTED: HeadsetSnapshot = {
  status: 'connected',
  readOnly: null,
  name: 'QCY H3',
  firmwareVersion: '0.1.2.3',
  battery: { percent: 30, charging: false },
  gameMode: null,
  anc: { mode: 'off' },
  eq: { kind: 'preset', presetId: 1 },
}

const LONG_NAME = 'a'.repeat(32)
const EMOJI = '😀'
const EMOJI_BYTES = 4

function renderApp(snapshot: HeadsetSnapshot = CONNECTED) {
  const bridge = createFakeBridge(snapshot)
  window.qcy = bridge
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
  return bridge
}

async function openDialog() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: COPY.rename.trigger }))
  return { user, input: await screen.findByLabelText(COPY.rename.nameLabel) }
}

const saveButton = () => screen.getByRole('button', { name: COPY.rename.save })
const dialogElement = () => document.querySelector('dialog')
const dialogStatus = () => within(screen.getByRole('dialog')).getByRole('status')

describe('rename trigger', () => {
  it.each([
    ['searching', { status: 'searching' as const }],
    ['read-only', { readOnly: 'unexpected-vendor' as const }],
  ])('is disabled when %s', async (_label, override) => {
    renderApp({ ...CONNECTED, ...override })
    expect(await screen.findByRole('button', { name: COPY.rename.trigger })).toBeDisabled()
  })

  it('is disabled and says why while game mode is on', async () => {
    renderApp({ ...CONNECTED, gameMode: true })

    const trigger = await screen.findByRole('button', { name: COPY.rename.trigger })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAccessibleDescription(COPY.rename.blockedByGameMode)
    expect(screen.getByText(COPY.rename.blockedByGameMode)).toBeVisible()
  })

  it('stays enabled without the game mode reason while game mode is off', async () => {
    renderApp({ ...CONNECTED, gameMode: false })

    expect(await screen.findByRole('button', { name: COPY.rename.trigger })).toBeEnabled()
    expect(screen.queryByText(COPY.rename.blockedByGameMode)).not.toBeInTheDocument()
  })
})

describe('rename dialog', () => {
  it('counts bytes, not characters', async () => {
    renderApp()
    const { user, input } = await openDialog()
    await user.clear(input)
    await user.type(input, EMOJI)
    expect(screen.getByText(COPY.rename.bytes(EMOJI_BYTES))).toBeInTheDocument()
  })

  it('blocks saving an empty or too long name and says why', async () => {
    renderApp()
    const { user, input } = await openDialog()
    await user.clear(input)
    expect(saveButton()).toBeDisabled()
    expect(screen.getByText(COPY.rename.invalid.empty)).toBeInTheDocument()

    await user.type(input, LONG_NAME)
    expect(saveButton()).toBeDisabled()
    const problem = screen.getByText(COPY.rename.invalid['too-long'])
    const counter = screen.getByText(COPY.rename.bytes(LONG_NAME.length))
    expect(input.getAttribute('aria-describedby')).toContain(problem.id)
    expect(input.getAttribute('aria-describedby')).toContain(counter.id)
  })

  it('saves a valid name and shows the Windows caching note', async () => {
    const bridge = renderApp()
    const { user, input } = await openDialog()
    await user.clear(input)
    await user.type(input, 'Meu H3')
    await user.click(saveButton())
    expect(await screen.findByText(COPY.rename.cachingNote)).toBeInTheDocument()
    expect(bridge.calls.filter((call) => call.channel === 'headset:rename')).toEqual([
      { channel: 'headset:rename', input: { name: 'Meu H3' } },
    ])
    expect(await screen.findByRole('heading', { name: 'Meu H3', level: 1 })).toBeInTheDocument()
  })

  it('shows the error text when the rename fails', async () => {
    const bridge = renderApp()
    bridge.failNext('headset:rename', IpcErrorCode.Timeout)
    const { user } = await openDialog()
    await user.click(saveButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(COPY.errors.timeout)
  })

  it('closes with Escape and returns focus to the trigger', async () => {
    renderApp()
    const { user } = await openDialog()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(dialogElement()).not.toHaveAttribute('open'))
    expect(screen.getByRole('button', { name: COPY.rename.trigger })).toHaveFocus()
  })

  it('closes with Cancelar and returns focus to the trigger', async () => {
    renderApp()
    const { user } = await openDialog()
    await user.click(screen.getByRole('button', { name: COPY.rename.cancel }))
    await waitFor(() => expect(dialogElement()).not.toHaveAttribute('open'))
    expect(screen.getByRole('button', { name: COPY.rename.trigger })).toHaveFocus()
  })
})

describe('rename dialog while saving', () => {
  const SLOW_RENAME_MS = 60

  it('blocks Escape and Cancelar until the rename settles', async () => {
    const bridge = renderApp()
    bridge.delayResponses('headset:rename', SLOW_RENAME_MS)
    const { user } = await openDialog()
    await user.click(saveButton())

    await user.keyboard('{Escape}')
    expect(dialogElement()).toHaveAttribute('open')
    expect(screen.getByRole('button', { name: COPY.rename.cancel })).toBeDisabled()

    expect(await screen.findByText(COPY.rename.cachingNote)).toBeInTheDocument()
    expect(dialogElement()).toHaveAttribute('open')
  })
})

describe('rename dialog typing while saving', () => {
  const SLOW_RENAME_MS = 400

  it('ignores typing and still shows the outcome when the reply arrives', async () => {
    const bridge = renderApp()
    bridge.delayResponses('headset:rename', SLOW_RENAME_MS)
    const { user, input } = await openDialog()
    await user.click(saveButton())
    expect(input).toHaveAttribute('readonly')

    await user.type(input, 'Z')
    expect(input).toHaveValue(CONNECTED.name)
    expect(saveButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: COPY.rename.cancel })).toBeDisabled()

    await waitFor(() => expect(dialogStatus()).toHaveTextContent(COPY.rename.cachingNote))
    expect(bridge.calls.filter((call) => call.channel === 'headset:rename')).toHaveLength(1)
  })
})

describe('rename dialog announcements', () => {
  it('has empty live regions ready before any content arrives', async () => {
    renderApp()
    const { user, input } = await openDialog()
    const [counterId, problemId] = (input.getAttribute('aria-describedby') ?? '').split(' ')
    const counter = document.getElementById(counterId ?? '')
    const problem = document.getElementById(problemId ?? '')

    expect(counter).not.toHaveAttribute('aria-live')
    expect(problem).toHaveAttribute('aria-live', 'polite')
    expect(problem).toBeEmptyDOMElement()
    const note = dialogStatus()
    expect(note).toBeEmptyDOMElement()

    await user.clear(input)
    expect(problem).toHaveTextContent(COPY.rename.invalid.empty)
    await user.type(input, 'Novo')
    await user.click(saveButton())
    await waitFor(() => expect(note).toHaveTextContent(COPY.rename.cachingNote))
  })
})

describe('rename dialog state', () => {
  it('drops the saved note when the name is edited', async () => {
    renderApp()
    const { user, input } = await openDialog()
    await user.type(input, 'X')
    await user.click(saveButton())
    await screen.findByText(COPY.rename.cachingNote)

    await user.type(input, 'Y')
    expect(screen.queryByText(COPY.rename.cachingNote)).not.toBeInTheDocument()
  })

  it('drops the error when the name is edited', async () => {
    const bridge = renderApp()
    bridge.failNext('headset:rename', IpcErrorCode.Timeout)
    const { user, input } = await openDialog()
    await user.click(saveButton())
    await screen.findByRole('alert')

    await user.type(input, 'Y')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers Fechar after saving', async () => {
    renderApp()
    const { user } = await openDialog()
    await user.click(saveButton())
    expect(await screen.findByRole('button', { name: COPY.rename.close })).toBeEnabled()
  })

  it('reopens with the current name and no old error or note', async () => {
    const bridge = renderApp()
    bridge.failNext('headset:rename', IpcErrorCode.Timeout)
    const first = await openDialog()
    await first.user.type(first.input, '2')
    await first.user.click(saveButton())
    await screen.findByRole('alert')
    await first.user.click(screen.getByRole('button', { name: COPY.rename.cancel }))
    await waitFor(() => expect(dialogElement()).not.toHaveAttribute('open'))

    const second = await openDialog()
    expect(second.input).toHaveValue(CONNECTED.name)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(dialogStatus()).toBeEmptyDOMElement()
  })
})
