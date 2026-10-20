import { COPY } from '../copy/pt-br'

interface GameModeTagProps {
  on: boolean
}

export function GameModeTag({ on }: GameModeTagProps) {
  return (
    <p role="status" aria-live="polite" className="game-mode-tag" data-on={on}>
      {on ? COPY.gameMode.on : COPY.gameMode.off}
    </p>
  )
}
