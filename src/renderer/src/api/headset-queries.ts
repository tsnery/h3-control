import {
  type QueryClient,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useEffect } from 'react'
import type { AncSetting, HeadsetSnapshot } from '../../../shared/headset-types'
import type { IpcRequest } from '../../../shared/ipc-contract'
import type { VolumeReading } from '../../../shared/volume-types'
import { type HeadsetApiError, callBridge } from './qcy-bridge'
import { headsetKeys, volumeKeys } from './query-keys'

const pushCounts = new WeakMap<QueryClient, number>()

function pushCountOf(queryClient: QueryClient): number {
  return pushCounts.get(queryClient) ?? 0
}

function recordPush(queryClient: QueryClient, snapshot: HeadsetSnapshot) {
  pushCounts.set(queryClient, pushCountOf(queryClient) + 1)
  queryClient.setQueryData(headsetKeys.snapshot(), snapshot)
}

async function fetchSnapshot(queryClient: QueryClient): Promise<HeadsetSnapshot> {
  const pushCountAtStart = pushCountOf(queryClient)
  const fetched = await callBridge('headset:get-snapshot', undefined)
  if (pushCountOf(queryClient) === pushCountAtStart) return fetched
  return queryClient.getQueryData<HeadsetSnapshot>(headsetKeys.snapshot()) ?? fetched
}

export function useHeadsetSnapshotSync() {
  const queryClient = useQueryClient()
  useEffect(
    () => window.qcy.onSnapshot((snapshot) => recordPush(queryClient, snapshot)),
    [queryClient],
  )
}

export function useHeadsetSnapshot(): HeadsetSnapshot {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery({
    queryKey: headsetKeys.snapshot(),
    queryFn: () => fetchSnapshot(queryClient),
    staleTime: Infinity,
  })
  return data
}

export function useSetAnc() {
  return useMutation<void, HeadsetApiError, AncSetting>({
    mutationFn: (setting) => callBridge('headset:set-anc', setting),
  })
}

export function useApplyEqPreset() {
  return useMutation<void, HeadsetApiError, IpcRequest<'headset:apply-eq-preset'>>({
    mutationFn: (request) => callBridge('headset:apply-eq-preset', request),
  })
}

export function useApplyCustomEq() {
  return useMutation<void, HeadsetApiError, IpcRequest<'headset:apply-custom-eq'>>({
    mutationFn: (request) => callBridge('headset:apply-custom-eq', request),
  })
}

export function useRename() {
  return useMutation<void, HeadsetApiError, string>({
    mutationFn: (name) => callBridge('headset:rename', { name }),
  })
}

export const VOLUME_REFRESH_MS = 3000

export function useVolume(): VolumeReading | null {
  const { data } = useSuspenseQuery({
    queryKey: volumeKeys.current(),
    queryFn: () => callBridge('volume:get', undefined),
    refetchInterval: VOLUME_REFRESH_MS,
  })
  return data
}

export function useSetVolume() {
  const queryClient = useQueryClient()
  return useMutation<void, HeadsetApiError, number>({
    mutationFn: (percent) => callBridge('volume:set', { percent }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: volumeKeys.current() }),
  })
}
