import type {
  AncSetting,
  ConnectionStatus,
  EqPresetId,
  EqState,
  HeadsetSnapshot,
} from '../../shared/headset-types'
import { ANC_CMD_ID, decodeAncSetting } from '../h3/anc'
import { type EqTlvFormat, decodeEqTlv, toEqState } from '../h3/eq'
import { type H3Command, h3Commands } from '../h3/h3-commands'
import { eqFormatForFirmware, isSupportedTarget } from '../h3/h3-model'
import { AdvType, type BatteryLevel, decodeAdvInfo, decodeBattery } from '../rcsp/adv-info'
import type { RcspCommandFrame, RcspResponseFrame } from '../rcsp/frame'
import { Opcode } from '../rcsp/opcode'
import { decodeTlvs } from '../rcsp/qcy-tlv'
import {
  type RcspClient,
  RcspClosedError,
  RcspStatusError,
  RcspTimeoutError,
  createRcspClient,
} from '../rcsp/rcsp-client'
import { type TargetInfo, decodeTargetInfo } from '../rcsp/target-info'
import type { KeyValueStore, Settings } from '../settings-store'
import { type ConnectedLink, type HeadsetTransport, TransportError } from '../transport/headset-transport'

export const POLL_INTERVAL_MS = 3000
export const ANC_ECHO_SUPPRESSION_MS = 1000
const LONGEST_BACKOFF_MS = 30000
export const RECONNECT_BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000, 16000, LONGEST_BACKOFF_MS]
const TIMEOUTS_MEANING_LINK_LOSS = 2

export class NotConnectedError extends Error {
  constructor(message: string = 'Headset is not connected') {
    super(message)
    this.name = 'NotConnectedError'
  }
}

export class ReadOnlyError extends Error {
  constructor(message: string = 'Headset is read-only') {
    super(message)
    this.name = 'ReadOnlyError'
  }
}

export interface HeadsetService {
  start(): void
  stop(): Promise<void>
  getSnapshot(): HeadsetSnapshot
  onSnapshot(listener: (snapshot: HeadsetSnapshot) => void): () => void
  setAnc(setting: AncSetting): Promise<void>
  applyEqPreset(id: EqPresetId): Promise<void>
  applyCustomEq(gainsDb: readonly number[]): Promise<void>
  rename(name: string): Promise<void>
}

type SessionProfile = { eqFormat: EqTlvFormat; writable: boolean }

type Session = {
  link: ConnectedLink
  client: RcspClient
  profile: SessionProfile | null
  consecutiveTimeouts: number
  unsubscribers: (() => void)[]
}

type ReadySession = { session: Session; profile: SessionProfile }

type AncTracking = { confirmed: AncSetting | null; pendingWrites: number; lastOwnChangeAt: number }

const INITIAL_SNAPSHOT: HeadsetSnapshot = {
  status: 'searching',
  readOnly: null,
  name: null,
  firmwareVersion: null,
  battery: null,
  anc: null,
  eq: null,
}

const LIVE_FIELDS_CLEARED = { battery: null, anc: null, eq: null } as const

const nameDecoder = new TextDecoder()

function findTlvData(payload: Uint8Array, cmdId: number): Uint8Array | null {
  return decodeTlvs(payload).find((tlv) => tlv.cmdId === cmdId)?.data ?? null
}

function decodeAncPayload(payload: Uint8Array): AncSetting | null {
  const data = findTlvData(payload, ANC_CMD_ID)
  return data === null ? null : decodeAncSetting(data)
}

function decodeEqPayload(payload: Uint8Array, format: EqTlvFormat): EqState | null {
  const data = findTlvData(payload, format)
  if (data === null) return null
  const decoded = decodeEqTlv(format, data)
  return decoded === null ? { kind: 'unknown' } : toEqState(decoded)
}

function decodeBatteryPayload(payload: Uint8Array): BatteryLevel | null {
  const value = decodeAdvInfo(payload).get(AdvType.Battery)
  return value === undefined ? null : decodeBattery(value)
}

function decodeNamePayload(payload: Uint8Array): string | null {
  const value = decodeAdvInfo(payload).get(AdvType.Name)
  return value === undefined ? null : nameDecoder.decode(value)
}

function sameSnapshot(left: HeadsetSnapshot, right: HeadsetSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function backoffDelayMs(attempt: number): number {
  return RECONNECT_BACKOFF_MS[attempt] ?? LONGEST_BACKOFF_MS
}

function isDeviceSilenceOrRefusal(error: unknown): boolean {
  return error instanceof RcspTimeoutError || error instanceof RcspStatusError
}

function isLinkError(error: unknown): boolean {
  return (
    error instanceof RcspTimeoutError ||
    error instanceof RcspClosedError ||
    error instanceof TransportError ||
    error instanceof NotConnectedError
  )
}

function warnInConsole(error: unknown, context: string): void {
  console.warn(`[headset] ${context}`, error)
}

async function identify(client: RcspClient): Promise<TargetInfo> {
  try {
    return decodeTargetInfo((await client.request(h3Commands.getTargetInfo())).payload)
  } catch (error) {
    if (!(error instanceof RcspTimeoutError)) throw error
  }
  try {
    await client.request(h3Commands.notifyCommunicationWayBle())
  } catch (error) {
    if (!isDeviceSilenceOrRefusal(error)) throw error
  }
  return decodeTargetInfo((await client.request(h3Commands.getTargetInfo())).payload)
}

async function disconnectQuietly(link: ConnectedLink): Promise<void> {
  try {
    await link.disconnect()
  } catch {
    // The link is being abandoned either way; a failed disconnect leaves nothing to undo.
  }
}

export type HeadsetServiceDeps = {
  transport: HeadsetTransport
  settings: KeyValueStore
  onError?: (error: unknown, context: string) => void
}

export function createHeadsetService(deps: HeadsetServiceDeps): HeadsetService {
  const { transport, settings } = deps
  const reportError = deps.onError ?? warnInConsole
  const listeners = new Set<(snapshot: HeadsetSnapshot) => void>()
  const anc: AncTracking = { confirmed: null, pendingWrites: 0, lastOwnChangeAt: Number.NEGATIVE_INFINITY }
  let snapshot = INITIAL_SNAPSHOT
  let running = false
  let current: Session | null = null
  let hasConnectedBefore = false
  let failedAttempts = 0
  let connectAbort: AbortController | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let queue: Promise<unknown> = Promise.resolve()

  const update = (patch: Partial<HeadsetSnapshot>): void => {
    const next = { ...snapshot, ...patch }
    if (sameSnapshot(next, snapshot)) return
    snapshot = next
    for (const listener of listeners) {
      try {
        listener(next)
      } catch (error) {
        reportError(error, 'snapshot listener')
      }
    }
  }

  const persist = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    try {
      if (settings.get(key) === value) return
      settings.set(key, value)
    } catch (error) {
      reportError(error, `saving setting ${key}`)
    }
  }

  const disconnectedStatus = (): ConnectionStatus => (hasConnectedBefore ? 'reconnecting' : 'searching')

  const connectFailureStatus = (error: unknown): ConnectionStatus => {
    if (error instanceof TransportError && error.code === 'adapter-unavailable') return 'bluetooth-off'
    return disconnectedStatus()
  }

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation)
    queue = result.catch(() => undefined)
    return result
  }

  const runExclusive = <T>(session: Session, operation: (client: RcspClient) => Promise<T>): Promise<T> =>
    enqueue(async () => {
      if (current !== session) throw new NotConnectedError()
      try {
        return await operation(session.client)
      } catch (error) {
        throw error instanceof RcspClosedError ? new NotConnectedError() : error
      }
    })

  const scheduleReconnect = (): void => {
    if (!running || reconnectTimer !== undefined) return
    const delay = backoffDelayMs(failedAttempts)
    failedAttempts += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      void connectOnce()
    }, delay)
  }

  const endSession = async (session: Session): Promise<void> => {
    if (current !== session) return
    current = null
    clearTimeout(pollTimer)
    session.unsubscribers.forEach((unsubscribe) => unsubscribe())
    session.client.close()
    anc.confirmed = null
    update({ ...LIVE_FIELDS_CLEARED, status: disconnectedStatus() })
    scheduleReconnect()
    await disconnectQuietly(session.link)
  }

  const exchange = async (session: Session, command: H3Command): Promise<RcspResponseFrame | null> => {
    try {
      const response = await session.client.request(command)
      session.consecutiveTimeouts = 0
      return response
    } catch (error) {
      if (error instanceof RcspStatusError) {
        session.consecutiveTimeouts = 0
        return null
      }
      if (!(error instanceof RcspTimeoutError)) throw error
      session.consecutiveTimeouts += 1
      if (session.consecutiveTimeouts < TIMEOUTS_MEANING_LINK_LOSS) return null
      await endSession(session)
      throw new NotConnectedError('Headset stopped answering')
    }
  }

  const applyDeviceAnc = (setting: AncSetting): void => {
    if (anc.pendingWrites > 0) return
    anc.confirmed = setting
    update({ anc: setting })
  }

  const refreshBattery = async (session: Session): Promise<void> => {
    const response = await exchange(session, h3Commands.readBattery())
    const battery = response === null ? null : decodeBatteryPayload(response.payload)
    if (battery !== null && current === session) update({ battery })
  }

  const refreshName = async (session: Session): Promise<void> => {
    const response = await exchange(session, h3Commands.readName())
    const name = response === null ? null : decodeNamePayload(response.payload)
    if (name !== null && current === session) update({ name })
  }

  const refreshAnc = async (session: Session): Promise<void> => {
    const response = await exchange(session, h3Commands.readAnc())
    const setting = response === null ? null : decodeAncPayload(response.payload)
    if (setting !== null && current === session) applyDeviceAnc(setting)
  }

  const refreshEq = async (session: Session, format: EqTlvFormat): Promise<void> => {
    const response = await exchange(session, h3Commands.readEq(format))
    const eq = response === null ? null : decodeEqPayload(response.payload, format)
    if (eq !== null && current === session) update({ eq })
  }

  const setUp = async (session: Session): Promise<SessionProfile> => {
    const targetInfo = await identify(session.client)
    const profile = { eqFormat: eqFormatForFirmware(targetInfo.firmwareVersion), writable: isSupportedTarget(targetInfo) }
    update({ firmwareVersion: targetInfo.firmwareVersion, readOnly: profile.writable ? null : 'unexpected-vendor' })
    if (profile.writable) {
      persist('preferredDeviceId', session.link.deviceId)
      await exchange(session, h3Commands.syncTime(new Date()))
    }
    await refreshBattery(session)
    await refreshName(session)
    await refreshAnc(session)
    await refreshEq(session, profile.eqFormat)
    return profile
  }

  const handlePush = (session: Session, frame: RcspCommandFrame): void => {
    if (current !== session || frame.opcode !== Opcode.Custom) return
    const setting = decodeAncPayload(frame.payload)
    if (setting === null) return
    if (Date.now() - anc.lastOwnChangeAt < ANC_ECHO_SUPPRESSION_MS) return
    applyDeviceAnc(setting)
  }

  const pollOnce = async (session: Session): Promise<void> => {
    await refreshBattery(session)
    await refreshAnc(session)
  }

  const schedulePoll = (session: Session): void => {
    pollTimer = setTimeout(() => void pollAndReschedule(session), POLL_INTERVAL_MS)
  }

  const pollAndReschedule = async (session: Session): Promise<void> => {
    try {
      await runExclusive(session, () => pollOnce(session))
    } catch (error) {
      if (isLinkError(error)) await endSession(session)
      else reportError(error, 'polling')
    }
    if (current === session) schedulePoll(session)
  }

  const openSession = (link: ConnectedLink): Session => {
    const client = createRcspClient(link)
    const session: Session = { link, client, profile: null, consecutiveTimeouts: 0, unsubscribers: [] }
    session.unsubscribers.push(
      link.onDisconnect(() => void endSession(session)),
      client.onPush((frame) => handlePush(session, frame)),
    )
    return session
  }

  const runSession = async (link: ConnectedLink): Promise<void> => {
    const session = openSession(link)
    current = session
    update({ status: 'connecting' })
    try {
      session.profile = await setUp(session)
    } catch (error) {
      if (!isLinkError(error)) reportError(error, 'session setup')
      await endSession(session)
      return
    }
    if (current !== session) return
    hasConnectedBefore = true
    failedAttempts = 0
    update({ status: 'connected' })
    schedulePoll(session)
  }

  const finishAttempt = (abort: AbortController): void => {
    if (connectAbort === abort) connectAbort = null
  }

  const connectOnce = async (): Promise<void> => {
    if (!running || current !== null || connectAbort !== null) return
    const abort = new AbortController()
    connectAbort = abort
    let link: ConnectedLink
    try {
      link = await transport.connect({ preferredDeviceId: settings.get('preferredDeviceId'), signal: abort.signal })
    } catch (error) {
      finishAttempt(abort)
      if (abort.signal.aborted) return
      update({ status: connectFailureStatus(error) })
      scheduleReconnect()
      return
    }
    finishAttempt(abort)
    if (abort.signal.aborted || current !== null) {
      await disconnectQuietly(link)
      return
    }
    await runSession(link)
  }

  const requireWritable = (): ReadySession => {
    const session = current
    if (session === null || session.profile === null) throw new NotConnectedError()
    if (!session.profile.writable) throw new ReadOnlyError()
    return { session, profile: session.profile }
  }

  const setAnc = async (setting: AncSetting): Promise<void> => {
    const { session } = requireWritable()
    const command = h3Commands.setAnc(setting)
    anc.pendingWrites += 1
    update({ anc: setting })
    try {
      await runExclusive(session, (client) => client.request(command))
      anc.confirmed = setting
      anc.lastOwnChangeAt = Date.now()
    } finally {
      anc.pendingWrites -= 1
      if (anc.pendingWrites === 0 && current === session) update({ anc: anc.confirmed })
    }
  }

  const applyEqPreset = async (id: EqPresetId): Promise<void> => {
    const { session, profile } = requireWritable()
    const command = h3Commands.applyEqPreset(id, profile.eqFormat)
    await runExclusive(session, (client) => client.request(command))
    if (current === session) update({ eq: { kind: 'preset', presetId: id } })
  }

  const applyCustomEq = async (gainsDb: readonly number[]): Promise<void> => {
    const { session, profile } = requireWritable()
    await runExclusive(session, async (client) => {
      const isFirstCustomWrite = !settings.get('hasWrittenCustomEq')
      await client.request(h3Commands.applyCustomEq(gainsDb, profile.eqFormat, isFirstCustomWrite))
      persist('hasWrittenCustomEq', true)
    })
    if (current === session) update({ eq: { kind: 'custom', gainsDb: [...gainsDb] } })
  }

  const rename = async (name: string): Promise<void> => {
    const { session } = requireWritable()
    const command = h3Commands.rename(name)
    await runExclusive(session, async (client) => {
      await client.request(command)
      await refreshName(session)
    })
  }

  return {
    start: () => {
      if (running) return
      running = true
      void connectOnce()
    },
    stop: async () => {
      running = false
      connectAbort?.abort()
      connectAbort = null
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
      if (current !== null) await endSession(current)
    },
    getSnapshot: () => snapshot,
    onSnapshot: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setAnc,
    applyEqPreset,
    applyCustomEq,
    rename,
  }
}
