import { useHeadsetSnapshotSync } from './api/headset-queries'
import { ConnectionHeader } from './components/connection-header'
import { AncPanel } from './components/anc-panel'
import { EqPanel } from './components/eq-panel'
import { RenameButton } from './components/rename-dialog'
import { VolumePanel } from './components/volume-panel'
import { QueryBoundary } from './components/query-boundary'

export function App() {
  useHeadsetSnapshotSync()
  return (
    <main>
      <QueryBoundary>
        <ConnectionHeader />
      </QueryBoundary>
      <QueryBoundary>
        <RenameButton />
      </QueryBoundary>
      <QueryBoundary>
        <AncPanel />
      </QueryBoundary>
      <QueryBoundary>
        <EqPanel />
      </QueryBoundary>
      <QueryBoundary>
        <VolumePanel />
      </QueryBoundary>
    </main>
  )
}
