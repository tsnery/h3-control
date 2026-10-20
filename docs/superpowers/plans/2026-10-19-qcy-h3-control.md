# QCY H3 Control — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App Electron para Windows 11 que controla o fone QCY H3 por BLE (Jieli RCSP): ANC, EQ (perfis oficiais + personalizado), renomear, bateria, firmware, volume e atalho na bandeja.

**Architecture:** Processo principal do Electron faz todo o Bluetooth (pacote `webbluetooth`) em camadas puras e testáveis: `transport` → `rcsp` (quadros, cliente com sn/timeout) → `h3` (tabelas e construtores de comandos permitidos) → `headset-service` (sessão, polling, reconexão, estado). O renderer React só fala com o main por um contrato IPC tipado e validado com zod, consumido via TanStack Query.

**Tech Stack:** Electron 44.9.0, electron-vite 6.0.0, Vite 8.3.4, electron-builder 26.15.3, webbluetooth 7.1.0, React 19.3.1, @tanstack/react-query 5.104.4, react-error-boundary 6.1.6, zod 4.6.7, TypeScript 6.0.3, Vitest 5.0.5, @testing-library/react 16.3.3, @testing-library/user-event 14.6.8, @testing-library/jest-dom 7.0.1, jsdom 30.1.3, @playwright/test 1.64.1, @electron/fuses 2.1.3, ESLint 10.13.0 + typescript-eslint 8.71.2, tsx (última) para scripts, pnpm 10, Node 24.

**Spec:** `docs/superpowers/specs/2026-10-19-qcy-h3-control-design.md` (protocolo: `docs/protocol/qcy-h3-rcsp.md`). Leia os dois antes de qualquer tarefa.

## Global Constraints

- Windows 11 x64; sem privilégios de administrador; sem troca de driver Bluetooth.
- O app em execução nunca acessa a internet.
- Nenhum quadro da lista NÃO ENVIAR (§8 de `docs/protocol/qcy-h3-rcsp.md`) pode ser construído: opcodes permitidos são só `0x03`, `0x0B` (payload exatamente `00 00`), `0xC0` (tipos ADV 1 e 7), `0xC1`, `0xFF` (TLVs `17`, `20`, `22` e leituras `FE 01 17|20|22`).
- Só conecta a periférico com nome exatamente `QCY H3-APP` e serviço `0000a002-0000-1000-8000-00805f9b34fb` (escrita `00000001-…`, notificação `00000002-…`).
- TypeScript estrito (`strict`, `noUncheckedIndexedAccess`); proibido `any`; evitar `as` (exceto `as const`); exports nomeados (default só em arquivos de config exigidos por ferramentas); arquivos em kebab-case; constantes em SNAKE_CAPS; sem números/strings mágicos (constantes ou enums); early returns; lookups em objeto em vez de `switch`; async/await.
- React: componentes puros (sem constantes/funções declaradas dentro); dados via TanStack Query com `useSuspenseQuery`; chaves de cache só por fábrica (`headsetKeys`); nunca buscar dados em `useEffect` (assinar eventos é permitido); toda área com dados envolta em Suspense + error boundary com botão "Tentar de novo".
- Toda a interface em português do Brasil; textos centralizados em `src/renderer/src/copy/pt-br.ts`.
- Acessibilidade WCAG 2.2 AA: controles nativos, teclado completo, foco visível, contraste 4,5:1, `aria-live="polite"` para estado, `prefers-reduced-motion`, `forced-colors`.
- Testes descrevem comportamento, nomes sem "should", agrupados em `describe`. Todo bug corrigido ganha teste de regressão.
- Commits em Conventional Commits, mensagem que explica o quê e por quê; sem marcadores de ferramenta/IA.
- Pacotes com pnpm; `webbluetooth` em `dependencies` (é nativo; fica fora do bundle e do asar).

## Review Focus

1. **Fone desligado ou fora de alcance no meio de um comando** → o comando falha com mensagem clara ("Fone desconectado"), o app não trava e continua tentando reconectar. Teste na Task 8.
2. **Notificações corrompidas, partidas em vários pedaços, vários quadros juntos ou opcode desconhecido** → o parser ignora o lixo, nunca lança exceção e entrega os quadros válidos. Testes na Task 2.
3. **Nome com acentos/emoji** que cabe em 31 caracteres mas passa de 31 bytes UTF-8, ou só espaços → rejeitado antes de enviar, com motivo. Teste na Task 4.
4. **Cliques rápidos repetidos (ANC/EQ) enquanto um comando ainda está pendente, com polling acontecendo** → comandos saem em ordem, o estado final é o do último clique e o polling não "desfaz" a escolha na tela. Teste na Task 8.
5. **Bluetooth do PC desligado ou sem adaptador** → estado "Bluetooth do PC desligado", sem loop de erro, volta sozinho quando o Bluetooth liga. Teste na Task 8.

---

## Estrutura de arquivos

```
package.json, pnpm-lock.yaml, electron.vite.config.ts, tsconfig.json, tsconfig.node.json, tsconfig.web.json,
vitest.config.ts, playwright.config.ts, eslint.config.js, electron-builder.yml, .gitignore
resources/icon.ico, resources/tray-icon.png, resources/volume-host.ps1
scripts/probe.ts                         CLI da sonda de hardware
scripts/apply-fuses.cjs                  hook afterPack (fuses)
src/shared/headset-types.ts              tipos de domínio + schemas zod (AncSetting, EqPresetId, EqState, HeadsetSnapshot…)
src/shared/ipc-contract.ts               canais IPC, schemas de request/response, IpcResult, IpcErrorCode
src/main/index.ts                        ciclo de vida do app (wiring)
src/main/app-window.ts                   BrowserWindow seguro, esconder ao fechar
src/main/settings-store.ts               KeyValueStore em JSON no userData
src/main/rcsp/opcode.ts                  enum Opcode, constantes de quadro
src/main/rcsp/frame.ts                   encodeCommandFrame, tipos RcspFrame
src/main/rcsp/frame-parser.ts            parser de fluxo com ressincronização
src/main/rcsp/qcy-tlv.ts                 TLVs QCY (dentro do 0xFF)
src/main/rcsp/adv-info.ts                LTVs ADV (0xC0/0xC1)
src/main/rcsp/target-info.ts             decodificação do GetTargetInfo
src/main/rcsp/rcsp-client.ts             sn, casamento, timeout/reenvio, fila serial, pushes
src/main/h3/anc.ts                       tabela ANC ↔ bytes
src/main/h3/eq-presets.ts                perfis oficiais parseados com zod
src/main/h3/eq.ts                        codificação TLV 0x20/0x22, EQ personalizado, leitura
src/shared/headset-name.ts               validação do nome (main e renderer)
src/main/h3/h3-commands.ts               ÚNICOS construtores de comandos (lista permitida)
src/main/transport/headset-transport.ts  interfaces + TransportError
src/main/transport/web-bluetooth-transport.ts  implementação real
src/main/transport/fake-h3.ts            fone falso com estado (testes, e2e)
src/main/transport/fixtures/             quadros reais capturados pela sonda
src/main/headset/headset-service.ts      sessão, polling, reconexão, snapshot, comandos
src/main/volume/windows-volume.ts        controle de volume via host PowerShell
src/main/ipc/register-ipc.ts             handlers com validação de sender e zod
src/main/tray/tray-menu.ts               template do menu e tooltip (puro)
src/main/tray/tray-controller.ts         Tray do Electron
src/preload/index.ts                     contextBridge (window.qcy)
src/renderer/index.html
src/renderer/src/main.tsx, app.tsx
src/renderer/src/copy/pt-br.ts
src/renderer/src/styles/tokens.css, app.css
src/renderer/src/api/qcy-bridge.ts       acesso tipado a window.qcy + HeadsetApiError
src/renderer/src/api/query-keys.ts       fábricas headsetKeys, volumeKeys, preferencesKeys
src/renderer/src/api/headset-queries.ts  hooks de query/mutation
src/renderer/src/components/*.tsx        query-boundary, connection-header, live-announcer, anc-panel, eq-panel, eq-slider, rename-dialog, volume-panel
e2e/app.spec.ts
```

Testes ficam ao lado do código (`*.test.ts(x)`); e2e em `e2e/`.

---

### Task 1: Esqueleto do projeto seguro

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig*.json`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.js`, `.gitignore`, `src/main/index.ts`, `src/main/app-window.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/app.tsx`, `src/renderer/src/copy/pt-br.ts`, `src/renderer/src/styles/tokens.css`, `e2e/app.spec.ts`
- Test: `src/main/app-window.test.ts`, `e2e/app.spec.ts`

**Interfaces:**
- Produces: `createAppWindow(options: { preloadPath: string; rendererUrl: string | null; rendererFile: string }): BrowserWindow`; `SECURE_WEB_PREFERENCES` (objeto exportado); `COPY` (objeto pt-BR, começa com `COPY.appName = 'QCY H3 Control'`).
- Scripts do `package.json`: `dev`, `build`, `typecheck`, `lint`, `test` (vitest run), `test:e2e` (build + playwright), `probe` (`tsx scripts/probe.ts`), `dist`.

- [ ] **Step 1: Instalar dependências fixadas** (versões do Tech Stack, `pnpm add -E`). `vitest.config.ts` com dois `projects`: `main` (environment `node`, `src/main/**`, `src/shared/**`, `scripts/**`) e `renderer` (environment `jsdom`, `src/renderer/**`, setup com `@testing-library/jest-dom/vitest`). ESLint: `@typescript-eslint/no-explicit-any: error`, `no-restricted-syntax` proibindo `ExportDefaultDeclaration` fora de arquivos `*.config.*`.
- [ ] **Step 2: Teste que falha** `src/main/app-window.test.ts`:
  - `describe('SECURE_WEB_PREFERENCES')` → `it('isolates the renderer from Node')`: `contextIsolation === true`, `sandbox === true`, `nodeIntegration === false`, `webSecurity === true`.
- [ ] **Step 3: Rodar** `pnpm test -- app-window` → FAIL (módulo não existe).
- [ ] **Step 4: Implementar** `app-window.ts`: janela 960×720, `show: false` até `ready-to-show`, `SECURE_WEB_PREFERENCES` + `preload`; bloquear navegação (`will-navigate` → `preventDefault` se a URL não for a do app) e `setWindowOpenHandler(() => ({ action: 'deny' }))`. `index.html` com CSP `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:` (em dev, electron-vite injeta o que precisar via `connect-src` do servidor de dev). `index.ts`: `app.requestSingleInstanceLock()` (sai se falhar; `second-instance` foca a janela). Renderer mostra `<h1>{COPY.appName}</h1>`; `<html lang="pt-BR">`; `tokens.css` com variáveis de cor para claro/escuro (`prefers-color-scheme`) e `forced-colors`.
- [ ] **Step 5: Rodar** `pnpm test` → PASS; `pnpm typecheck` e `pnpm lint` → sem erros.
- [ ] **Step 6: E2E de fumaça** `e2e/app.spec.ts`: `describe('app shell')` → `it('opens a window titled QCY H3 Control')` com `_electron.launch({ args: ['out/main/index.js'] })`, `firstWindow()`, `expect(page.getByRole('heading', { level: 1 })).toHaveText('QCY H3 Control')`. Rodar `pnpm test:e2e` → PASS.
- [ ] **Step 7: Commit** `chore: scaffold secure Electron + React + TS app shell`.

---

### Task 2: Quadros RCSP e parser de fluxo

**Files:**
- Create: `src/main/rcsp/opcode.ts`, `src/main/rcsp/frame.ts`, `src/main/rcsp/frame-parser.ts`
- Test: `src/main/rcsp/frame.test.ts`, `src/main/rcsp/frame-parser.test.ts`

**Interfaces:**
- Produces:
  - `enum Opcode { GetTargetInfo = 0x03, UpdateSysInfo = 0x09, NotifyCommunicationWay = 0x0b, SetAdvInfo = 0xc0, GetAdvInfo = 0xc1, NotifyAdvInfo = 0xc2, RequestAdvOp = 0xc4, Custom = 0xff }`
  - `MAX_PARAM_LENGTH = 530`
  - `type RcspCommandFrame = { kind: 'command'; opcode: number; expectsResponse: boolean; sn: number; payload: Uint8Array }`
  - `type RcspResponseFrame = { kind: 'response'; opcode: number; status: number; sn: number; payload: Uint8Array }`
  - `type RcspFrame = RcspCommandFrame | RcspResponseFrame`
  - `encodeCommandFrame(input: { opcode: Opcode; sn: number; payload: Uint8Array }): Uint8Array` (flag sempre `0xC0`)
  - `createFrameParser(): { push(chunk: Uint8Array): RcspFrame[] }`

- [ ] **Step 1: Testes que falham** (bytes de `docs/protocol/qcy-h3-rcsp.md` §4):
  - `encodeCommandFrame`: `it('encodes the game-mode example byte for byte')` → `{opcode: SetAdvInfo, sn: 0x70, payload: [02 05 02]}` ⇒ `FE DC BA C0 C0 00 04 70 02 05 02 EF`.
  - `it('encodes an ANC command inside the custom opcode')` → `{opcode: Custom, sn: 0xBB, payload: [17 03 02 00 00]}` ⇒ `FE DC BA C0 FF 00 06 BB 17 03 02 00 00 EF`.
  - Parser `describe('createFrameParser')`:
    - `it('decodes a response frame')`: `FE DC BA 00 C0 00 03 00 70 00 EF` ⇒ `[{kind:'response', opcode:0xC0, status:0, sn:0x70, payload:[00]}]`.
    - `it('decodes a device-pushed command frame')`: `FE DC BA C0 FF 00 06 05 17 03 03 01 04 EF` ⇒ `kind:'command'`, `sn:5`, payload `17 03 03 01 04`.
    - `it('reassembles a frame split across three chunks')` (cortes no meio do prefixo e do corpo).
    - `it('returns every frame when one chunk carries two frames')`.
    - `it('skips leading garbage before the prefix')`.
    - `it('drops a frame whose end byte is not EF and resyncs on the next prefix')`.
    - `it('skips frames whose length exceeds 530')`.
    - `it('never throws on random bytes')`: 1000 chunks aleatórios (seed fixa) ⇒ não lança.
- [ ] **Step 2: Rodar** `pnpm test -- rcsp/frame` → FAIL.
- [ ] **Step 3: Implementar.** Layout: `FE DC BA | flag | opcode | paramLen u16 BE | body | EF`, total `paramLen + 8`; bit7 do flag = comando, bit6 = espera resposta; corpo de resposta = `status sn payload`, de comando = `sn payload`. Parser segue os 6 passos de §4.3 da referência (buffer interno por instância, não estático).
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat(rcsp): encode commands and parse notification streams`.

---

### Task 3: TLVs QCY, ADV info e TargetInfo

**Files:**
- Create: `src/main/rcsp/qcy-tlv.ts`, `src/main/rcsp/adv-info.ts`, `src/main/rcsp/target-info.ts`
- Test: os três `*.test.ts` correspondentes

**Interfaces:**
- Produces:
  - `QCY_READ_PREFIX = 0xfe`; `encodeTlv(cmdId: number, data: Uint8Array): Uint8Array` → `[cmdId, len, ...data]`; `encodeTlvRead(cmdId: number): Uint8Array` → `[FE, 01, cmdId]`; `type QcyTlv = { cmdId: number; data: Uint8Array }`; `decodeTlvs(payload: Uint8Array): QcyTlv[]` (para no primeiro TLV malformado).
  - `enum AdvType { Battery = 0, Name = 1, Time = 7 }`; `encodeAdvSet(type: AdvType, value: Uint8Array): Uint8Array` → `[value.length + 1, type, ...value]`; `encodeAdvGetMask(types: readonly number[]): Uint8Array` (u32 BE, bit n = tipo n); `decodeAdvInfo(payload: Uint8Array): Map<number, Uint8Array>` (LTV, len inclui o tipo); `type BatteryLevel = { percent: number; charging: boolean }`; `decodeBattery(value: Uint8Array): BatteryLevel | null` (primeiro byte; bit7 carregando; 1..100 válido).
  - `type TargetInfo = { firmwareVersion: string | null; vendorId: number | null; productId: number | null }`; `decodeTargetInfo(payload: Uint8Array): TargetInfo`.

- [ ] **Step 1: Testes que falham:**
  - `decodeTlvs`: `it('splits a read response into its TLV')` `17 03 01 05 00` ⇒ `[{cmdId:0x17, data:[01 05 00]}]`; `it('stops at a TLV whose length overruns the payload')`.
  - `encodeAdvGetMask([0,5,8,10,11])` ⇒ `00 00 0D 21`; `encodeAdvGetMask([1])` ⇒ `00 00 00 02`.
  - `decodeAdvInfo` de `02 00 1E 02 05 01` ⇒ tipo 0 → `[1E]`, tipo 5 → `[01]`; `decodeBattery([0x1E])` ⇒ `{percent:30, charging:false}`; `decodeBattery([0x9E])` ⇒ `{percent:30, charging:true}`; `decodeBattery([0x00])` ⇒ `null`.
  - `decodeTargetInfo`: payload com LTV tipo 5 `03 05 01 23` e tipo 10 `07 0A 05 D6 00 0A 00 00` ⇒ `{firmwareVersion:'0.1.2.3', vendorId:0x05D6, productId:0x000A}`; tipos desconhecidos ignorados; ausentes ⇒ `null`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar** (§6, §6.4, §6.7 da referência). **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat(rcsp): decode QCY TLVs, ADV info and target info`.

---

### Task 4: Modelo do H3 e lista de comandos permitidos

**Files:**
- Create: `src/shared/headset-types.ts`, `src/shared/headset-name.ts` (compartilhado: o renderer reusa na Task 14), `src/main/h3/anc.ts`, `src/main/h3/eq-presets.ts`, `src/main/h3/eq.ts`, `src/main/h3/h3-commands.ts`
- Test: `anc.test.ts`, `eq-presets.test.ts`, `eq.test.ts`, `src/shared/headset-name.test.ts`, `h3-commands.test.ts`

**Interfaces:**
- Consumes: `Opcode`, `encodeTlv`, `encodeTlvRead`, `encodeAdvSet`, `encodeAdvGetMask`, `AdvType`.
- Produces (`src/shared/headset-types.ts`, cada tipo com schema zod de mesmo nome + `Schema`):
  - `AncScene = 'adaptive' | 'noisy' | 'commuting' | 'indoor' | 'anti-wind'`; `AncLevel = 'low' | 'medium' | 'high'`
  - `AncSetting = { mode: 'off' } | { mode: 'transparency' } | { mode: 'noise-cancelling'; scene: AncScene; level: AncLevel | null }`
  - `EqPresetId = 1 | 2 | 3 | 4 | 5 | 6`; `CUSTOM_EQ_BAND_COUNT = 10`; `EQ_GAIN_LIMIT_DB = 8`; `CUSTOM_EQ_FREQUENCIES_HZ = [55, 220, 500, 1000, 1800, 2800, 4500, 7500, 10000, 22000]`
  - `EqState = { kind: 'preset'; presetId: EqPresetId } | { kind: 'custom'; gainsDb: readonly number[] } | { kind: 'unknown' }`
  - `ConnectionStatus = 'searching' | 'connecting' | 'connected' | 'reconnecting' | 'bluetooth-off'`; `ReadOnlyReason = 'unexpected-vendor'`
  - `HeadsetSnapshot = { status: ConnectionStatus; readOnly: ReadOnlyReason | null; name: string | null; firmwareVersion: string | null; battery: { percent: number; charging: boolean } | null; anc: AncSetting | null; eq: EqState | null }`
- Produces (main):
  - `encodeAncSetting(setting: AncSetting): Uint8Array` (TLV completo `17 03 MM SS LL`); `decodeAncSetting(data: Uint8Array): AncSetting | null`; `DEFAULT_NOISE_CANCELLING: AncSetting` = noisy/high.
  - `type EqBand = { frequencyHz: number; gainDb: number; q: number }`; `type EqPreset = { id: EqPresetId; name: string; masterGainDb: number; bands: readonly EqBand[] }`; `EQ_PRESETS: readonly EqPreset[]`; `CUSTOM_EQ_Q` (Q das bandas do EQ personalizado).
  - `enum EqTlvFormat { SixByte = 0x20, SevenByte = 0x22 }`; `encodeEqTlv(format: EqTlvFormat, index: number, masterGainDb: number, bands: readonly EqBand[]): Uint8Array`; `customMasterGainDb(gainsDb: readonly number[]): number` = `-5.5 - max(0, ...gains)`; `CUSTOM_EQ_INDEX = 0x80`, `FIRST_CUSTOM_EQ_INDEX = 0xff`; `decodeEqTlv(format: EqTlvFormat, data: Uint8Array): { index: number; masterGainDb: number; bands: EqBand[] } | null`; `toEqState(decoded): EqState`.
  - `HEADSET_NAME_MAX_BYTES = 31`; `validateHeadsetName(name: string): { ok: true; bytes: Uint8Array } | { ok: false; reason: 'empty' | 'too-long' }`.
  - `type H3Command = { opcode: Opcode; payload: Uint8Array }`; `h3Commands` (objeto congelado) com exatamente: `getTargetInfo()`, `notifyCommunicationWayBle()`, `syncTime(date: Date)`, `readBattery()`, `readName()`, `readAnc()`, `readEq(format: EqTlvFormat)`, `setAnc(setting: AncSetting)`, `applyEqPreset(id: EqPresetId, format: EqTlvFormat)`, `applyCustomEq(gainsDb: readonly number[], format: EqTlvFormat, isFirstCustomWrite: boolean)`, `rename(name: string)` (lança `RangeError` se inválido).

- [ ] **Step 1: Testes que falham:**
  - `anc.test.ts` `describe('encodeAncSetting')` com tabela (`it.each`) cobrindo §7 da referência: off ⇒ `17 03 02 00 00`; transparency ⇒ `17 03 03 01 04`; adaptive ⇒ `17 03 01 05 00`; noisy low/medium/high ⇒ `…01 01 00/01/02`; commuting ⇒ `…01 02 0L`; indoor ⇒ `…01 03 0L`; anti-wind ⇒ `17 03 01 04 00`. `decodeAncSetting` é o inverso para os mesmos dados (adaptive/anti-wind ⇒ `level: null`); bytes desconhecidos ⇒ `null`.
  - `eq-presets.test.ts`: `it('loads the six official H3 presets in panel order')` ⇒ ids 1..6 com nomes `Default, Pop, Heavy Bass, Rock, Soft, Classic`; `it('keeps the official Default curve')` ⇒ master −5.5 e bandas `[55,+2.5,0.4],[220,−11,0.8],[500,+1,0.7],[1800,+2.5,1.0],[2800,+3,0.8],[4500,+2,1.3],[7500,+2.5,1.2]`; `it('reads Heavy Bass master gain given as a number')` ⇒ −5.
  - `eq.test.ts`:
    - `it('encodes the Default preset as TLV 0x20')` ⇒ começa com `20 2D 01 DA FD 37 00 FA 00 28 00` e tem 47 bytes.
    - `it('encodes TLV 0x22 with filter type 2 per band')` ⇒ `22 <n×7+3> …` cada banda termina em `02`.
    - `it('encodes negative gains as signed little-endian centi-dB')` ⇒ −11 dB ⇒ `B4 FB`.
    - `customMasterGainDb([0,3,…])` ⇒ −8.5; todos ≤ 0 ⇒ −5.5.
    - `applyCustomEq` com 9 valores, valor 9, ou 2.5 ⇒ `RangeError`.
    - `decodeEqTlv` é o inverso de `encodeEqTlv`; `toEqState` índice 3 ⇒ preset 3; índice `0x80` com as 10 frequências custom ⇒ `custom` com os ganhos; outro ⇒ `unknown`.
  - `src/shared/headset-name.test.ts`: `'  Meu H3  '` ⇒ ok, bytes de `'Meu H3'`; `'   '` ⇒ `empty`; 31 bytes ASCII ⇒ ok; 32 ⇒ `too-long`; `'Fone 🎧🎧🎧🎧🎧🎧🎧'` (≤ 31 caracteres, > 31 bytes) ⇒ `too-long` (Review Focus 3).
  - `h3-commands.test.ts`:
    - `it('exposes only the allowlisted builders')` ⇒ `Object.keys(h3Commands).sort()` igual à lista acima.
    - `it('never builds a frame outside the allowlist')`: chama todos os construtores com argumentos variados (todas as ANC, todos os presets nos dois formatos, custom extremos, nomes) e afirma: opcode ∈ {0x03, 0x0B, 0xC0, 0xC1, 0xFF}; `0x0B` ⇒ payload `00 00`; `0xC0` ⇒ tipo ADV (byte 1) ∈ {1, 7}; `0xFF` ⇒ primeiro byte ∈ {0x17, 0x20, 0x22, 0xFE} e, se `0xFE`, terceiro byte ∈ {0x17, 0x20, 0x22}.
    - Bytes exatos: `getTargetInfo()` ⇒ `FF FF FF FF 00`; `readBattery()` ⇒ `00 00 0D 21`; `readName()` ⇒ `00 00 00 02`; `readAnc()` ⇒ `FE 01 17`; `syncTime(new Date(1_760_000_000_000))` ⇒ `05 07 68 E7 78 00`; `rename('H3')` ⇒ opcode `C0`, payload `03 01 48 33`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** `eq-presets.ts` faz parse do JSON com zod (`eqs`/`q`/`freq` são strings CSV; `mastergain` pode ser string ou número). **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat(h3): model ANC and EQ tables with an allowlist of safe commands`.

---

### Task 5: Transporte (interface + fone falso) e cliente RCSP

**Files:**
- Create: `src/main/transport/headset-transport.ts`, `src/main/transport/fake-h3.ts`, `src/main/rcsp/rcsp-client.ts`
- Test: `src/main/rcsp/rcsp-client.test.ts`, `src/main/transport/fake-h3.test.ts`

**Interfaces:**
- Consumes: `encodeCommandFrame`, `createFrameParser`, `H3Command`, `encodeAncSetting`, `decodeAncSetting`, `encodeEqTlv`, `encodeTlv`.
- Produces:
  - `interface ConnectedLink { readonly deviceId: string; readonly deviceName: string; write(frame: Uint8Array): Promise<void>; onNotification(listener: (chunk: Uint8Array) => void): () => void; onDisconnect(listener: () => void): () => void; disconnect(): Promise<void> }`
  - `interface HeadsetTransport { connect(options: { preferredDeviceId: string | null; signal: AbortSignal }): Promise<ConnectedLink> }`
  - `class TransportError extends Error { readonly code: TransportErrorCode }`, `TransportErrorCode = 'adapter-unavailable' | 'device-not-found' | 'connect-failed' | 'service-missing' | 'write-failed'`
  - `type FakeH3State = { name: string; batteryPercent: number; anc: AncSetting; eqIndex: number; vendorId: number; firmwareVersion: string; respondsToTargetInfo: boolean }`; `createFakeH3(initial?: Partial<FakeH3State>): { transport: HeadsetTransport; state: () => FakeH3State; writtenFrames: () => Uint8Array[]; pressAncButton(setting: AncSetting): void; powerOff(): void; powerOn(): void; setAdapterAvailable(available: boolean): void }` — responde a cada comando conforme a referência (formatos de resposta serão ajustados com as fixtures na Task 7).
  - `interface RcspClient { request(command: H3Command): Promise<RcspResponseFrame>; onPush(listener: (frame: RcspCommandFrame) => void): () => void; close(): void }`
  - `createRcspClient(link: ConnectedLink, options?: { timeoutMs?: number; maxResends?: number }): RcspClient` (padrões 2000 e 3)
  - `class RcspTimeoutError extends Error`, `class RcspStatusError extends Error { readonly status: number }`, `class RcspClosedError extends Error`

- [ ] **Step 1: Testes que falham** (`vi.useFakeTimers()`):
  - `it('numbers commands from 0 and wraps after 255')`.
  - `it('resolves the response that matches opcode and sn')` (resposta de outro sn chega antes e é ignorada).
  - `it('resends the same frame after 2000 ms and fails after three resends')` ⇒ 4 escritas idênticas, depois `RcspTimeoutError`.
  - `it('rejects with the device status when it is not zero')` ⇒ `RcspStatusError` com `status: 2`.
  - `it('writes one frame at a time in call order')`: duas `request` simultâneas; a segunda escrita só ocorre depois que a primeira `write()` resolve.
  - `it('delivers device-pushed command frames to push listeners')`.
  - `it('rejects pending requests when the link disconnects')` ⇒ `RcspClosedError`.
  - `fake-h3.test.ts`: `it('answers a read of ANC with the current setting')`; `it('changes ANC when it receives setAnc')`; `it('rejects connect with adapter-unavailable when the adapter is off')`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat(rcsp): add request/response client over a transport interface`.

---

### Task 6: Transporte real (`webbluetooth`) e CLI da sonda

**Files:**
- Create: `src/main/transport/web-bluetooth-transport.ts`, `scripts/probe.ts`, `scripts/probe-plan.ts`
- Test: `src/main/transport/web-bluetooth-transport.test.ts`, `scripts/probe-plan.test.ts`

**Interfaces:**
- Consumes: `HeadsetTransport`, `ConnectedLink`, `TransportError`, `h3Commands`, `createRcspClient`, `encodeCommandFrame`.
- Produces:
  - `H3_DEVICE_NAME = 'QCY H3-APP'`, `RCSP_SERVICE_UUID`, `RCSP_WRITE_UUID`, `RCSP_NOTIFY_UUID`
  - `isSupportedHeadsetName(name: string | undefined): boolean` (igualdade exata)
  - `createWebBluetoothTransport(): HeadsetTransport` — `new Bluetooth({ devicesFound })` escolhendo o `preferredDeviceId` se presente, senão o primeiro com nome suportado; `requestDevice({ filters: [{ name: H3_DEVICE_NAME }], optionalServices: [RCSP_SERVICE_UUID] })`; `getAvailability()` falso ⇒ `TransportError('adapter-unavailable')`; liga notificações; escreve com `writeValueWithoutResponse` se a característica permitir, senão `writeValueWithResponse`; `gattserverdisconnected` ⇒ listeners de desconexão.
  - `type ProbeStep = { label: string; command: H3Command } | { label: string; pause: string }`; `buildProbePlan(stage: 'a' | 'b', context: { ancBefore: AncSetting | null; eqFrameHex: string | null }): ProbeStep[]`
  - CLI: `pnpm probe -- --stage a|b [--dry-run]`; `--dry-run` imprime cada passo como `<label>: <hex do quadro com sn=00>` e não abre Bluetooth; execução real grava `probe-output/<stage>-<timestamp>.json` com `{ startedAt, deviceId, deviceName, steps: [{ label, txHex, rxChunksHex[], rxFrames[], elapsedMs, error }], pushes: [...] }`.

- [ ] **Step 1: Testes que falham:**
  - `isSupportedHeadsetName`: `'QCY H3-APP'` ⇒ true; `'QCY H3 Pro-APP'`, `'QCY H3S-APP'`, `'qcy h3-app'`, `undefined` ⇒ false.
  - `buildProbePlan('a', …)` ⇒ rótulos e comandos nesta ordem: `GetTargetInfo`, `SyncTime`, `ReadBattery`, `ReadName`, `ReadAnc`, `ReadEq20`, `ReadEq22`. Nenhum é `setAnc`/`applyEq*`/`rename`.
  - `buildProbePlan('b', { ancBefore: off, eqFrameHex })` ⇒ `ReadAnc`, `SetAncTransparency`, pausa "Confira o som e aperte o botão de ANC do fone", `ReadAnc`, `RestoreAnc` (= `ancBefore`), `ReadAnc`, `RewriteCurrentEq` (o mesmo EQ lido na etapa A; omitido se `eqFrameHex` for `null`).
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** Se `GetTargetInfo` não responder na etapa A, o CLI envia `notifyCommunicationWayBle()` e tenta de novo (registra os dois). **Step 4: Rodar** → PASS; `pnpm probe -- --stage a --dry-run` imprime 7 linhas começando por `GetTargetInfo: FE DC BA C0 03 00 06 00 FF FF FF FF 00 EF`.
- [ ] **Step 5: Commit** `feat(transport): connect to the H3 over webbluetooth and add a hardware probe CLI`.

---

### Task 7: ⛔ PONTO DE PARADA — sonda no fone do dono

Não é código novo. O executor **para e chama o dono**.

- [ ] **Step 1:** Rodar `pnpm probe -- --stage a --dry-run` e mostrar ao dono a lista exata de quadros. Pedir: fone ligado e conectado ao PC, Bluetooth do celular desligado, autorização explícita.
- [ ] **Step 2:** Com autorização, rodar `pnpm probe -- --stage a`. Conferir: conexão OK com áudio tocando; resposta a GetTargetInfo (anotar se precisou de `0B 00 00`); versão do firmware; vendorId; formato real das respostas de `FE 01 17`, `FE 01 20`, `FE 01 22`, `C1`.
- [ ] **Step 3:** Se o firmware for > `0.8.0.7999`: reavaliar `0x20`/`0x22`. Se o EQ lido vier só em `0x22`, usar `SevenByte`.
- [ ] **Step 4:** Mostrar ao dono a lista da etapa B (`--dry-run` com o contexto real), pedir autorização, rodar `pnpm probe -- --stage b`. O dono confirma Transparência pelo ouvido e aperta o botão físico de ANC durante a pausa.
- [ ] **Step 5:** Aplicar os fallbacks do spec §6.1 se algo falhar (MTU, conexão, status de erro) — **parar e voltar ao dono** em vez de improvisar.
- [ ] **Step 6:** Salvar as capturas em `src/main/transport/fixtures/h3-probe-a.json` e `h3-probe-b.json`; ajustar `fake-h3.ts` para responder exatamente nesses formatos e acrescentar ao `fake-h3.test.ts` `it('replays the captured probe session byte for byte')`; registrar em `docs/protocol/qcy-h3-rcsp.md` uma seção "Observado no H3 do dono (2026-10-…)" com os fatos confirmados/refutados; fixar no `h3-model` o formato de EQ e a necessidade de `0B 00 00`.
- [ ] **Step 7:** `pnpm test` → PASS. Commit `test(h3): capture real H3 session and align fake headset with it`.

---

### Task 8: Serviço do fone (sessão, estado, polling, reconexão, comandos)

**Files:**
- Create: `src/main/settings-store.ts`, `src/main/headset/headset-service.ts`
- Test: `src/main/settings-store.test.ts`, `src/main/headset/headset-service.test.ts`

**Interfaces:**
- Consumes: `HeadsetTransport`, `createRcspClient`, `h3Commands`, decodificadores das Tasks 3–4, `createFakeH3` (testes), fixtures da Task 7.
- Produces:
  - `type Settings = { preferredDeviceId: string | null; hasWrittenCustomEq: boolean }`; `interface KeyValueStore { get<K extends keyof Settings>(key: K): Settings[K]; set<K extends keyof Settings>(key: K, value: Settings[K]): void }`; `createJsonSettingsStore(filePath: string): KeyValueStore`; `createMemorySettingsStore(): KeyValueStore`
  - `POLL_INTERVAL_MS = 3000`, `ANC_ECHO_SUPPRESSION_MS = 1000`, `RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000]`, `EXPECTED_JIELI_VENDOR_ID = 0x05d6`
  - `class NotConnectedError extends Error`, `class ReadOnlyError extends Error`
  - `interface HeadsetService { start(): void; stop(): Promise<void>; getSnapshot(): HeadsetSnapshot; onSnapshot(listener: (snapshot: HeadsetSnapshot) => void): () => void; setAnc(setting: AncSetting): Promise<void>; applyEqPreset(id: EqPresetId): Promise<void>; applyCustomEq(gainsDb: readonly number[]): Promise<void>; rename(name: string): Promise<void> }`
  - `createHeadsetService(deps: { transport: HeadsetTransport; settings: KeyValueStore; eqFormat: EqTlvFormat }): HeadsetService`

- [ ] **Step 1: Testes que falham** (fake H3 + `vi.useFakeTimers()`), em `describe`s por comportamento:
  - Sessão: `it('runs the official session sequence after connecting')` ⇒ ordem dos quadros: GetTargetInfo, SyncTime, ReadBattery, ReadName, ReadAnc, ReadEq; snapshot final `status:'connected'`, nome, firmware, bateria, ANC, EQ preenchidos. `it('remembers the connected device as preferred')`.
  - `it('falls back to notify-communication-way when target info does not answer')` (fake com `respondsToTargetInfo:false` na primeira tentativa).
  - Somente leitura: `it('enters read-only mode when the vendor id is not Jieli')` ⇒ `readOnly:'unexpected-vendor'`; `setAnc` rejeita `ReadOnlyError` e nenhum quadro de escrita sai.
  - Polling: `it('polls battery and ANC every 3 seconds')`; `it('applies an ANC change pushed by the physical button')`.
  - Review Focus 4: `it('keeps the last chosen ANC when clicks race with polling')`: `setAnc(transparency)`, `setAnc(off)` sem await, poll no meio devolvendo o valor antigo ⇒ snapshot final `off` e quadros saem em ordem.
  - Review Focus 1: `it('rejects commands while disconnected and keeps reconnecting')`: `powerOff()` ⇒ `status:'reconnecting'`; `setAnc` ⇒ `NotConnectedError`; tentativas em 1 s, 2 s, 4 s…; `powerOn()` ⇒ volta a `connected`.
  - Review Focus 5: `it('reports bluetooth-off and recovers when the adapter returns')`: `setAdapterAvailable(false)` ⇒ `status:'bluetooth-off'`, sem mais de uma tentativa por intervalo de backoff; `setAdapterAvailable(true)` ⇒ `connected`.
  - EQ: `it('uses index 0xFF for the first custom EQ and 0x80 afterwards')` (persistido em `hasWrittenCustomEq`); `it('updates the snapshot to the applied preset')`.
  - Nome: `it('renames and reads the new name back')`; `it('rejects an invalid name without sending a frame')`.
  - `settings-store.test.ts`: `it('persists values across instances')` (arquivo temporário); `it('returns defaults when the file is missing or corrupt')`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar** conforme spec §4.3. **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat(headset): manage the H3 session, polling, reconnection and commands`.

---

### Task 9: Volume do fone no Windows

**Files:**
- Create: `resources/volume-host.ps1`, `src/main/volume/windows-volume.ts`, `scripts/volume-check.ts` (CLI `get` | `set <percent>` para verificação manual)
- Test: `src/main/volume/windows-volume.test.ts`

**Interfaces:**
- Produces:
  - `type VolumeReading = { percent: number; muted: boolean; endpointName: string }`
  - `interface VolumeControl { get(): Promise<VolumeReading | null>; set(percent: number): Promise<void>; dispose(): void }` (`null` = nenhum endpoint de reprodução ativo do H3)
  - `createWindowsVolumeControl(spawnHost: () => VolumeHostProcess): VolumeControl`; `type VolumeHostProcess = { stdin: Writable; stdout: Readable; kill(): void; onExit(listener: () => void): void }`; `spawnPowerShellVolumeHost(scriptPath: string): VolumeHostProcess` (`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <script>`)
  - Protocolo do host: uma linha JSON por comando (`{"id":1,"op":"get"}` / `{"id":2,"op":"set","percent":40}`), uma linha JSON por resposta (`{"id":1,"ok":true,"percent":40,"muted":false,"endpointName":"Fones de ouvido (QCY H3)"}` / `{"id":1,"ok":true,"endpoint":null}` / `{"id":1,"ok":false,"error":"…"}`).
- `volume-host.ps1`: `Add-Type` com C# de interop Core Audio (`IMMDeviceEnumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)`, `PKEY_Device_FriendlyName`, `IAudioEndpointVolume.Get/SetMasterVolumeLevelScalar`, `GetMute`); escolhe o endpoint cujo nome contém `QCY H3` e **não** contém `Hands-Free`; loop lendo stdin.

- [ ] **Step 1: Testes que falham** (host falso com streams em memória): `it('reads the H3 endpoint volume')`; `it('returns null when the H3 is not an active output')`; `it('sends set commands with integer percent clamped to 0..100')`; `it('rejects a request the host does not answer within 3 seconds')`; `it('restarts the host after it exits and serves the next request')`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.
- [ ] **Step 5: Verificação manual** com o fone tocando: `pnpm tsx scripts/volume-check.ts get` mostra o mesmo % do mixer do Windows; `set 30` muda o mixer. Se não funcionar de forma confiável, **parar e avisar o dono** (spec: o slider sai da v1).
- [ ] **Step 6: Commit** `feat(volume): read and set the H3 endpoint volume through Core Audio`.

---

### Task 10: Contrato IPC, handlers e preload

**Files:**
- Create: `src/shared/ipc-contract.ts`, `src/main/ipc/register-ipc.ts`, `src/preload/index.ts` (substitui o da Task 1)
- Test: `src/main/ipc/register-ipc.test.ts`, `src/shared/ipc-contract.test.ts`

**Interfaces:**
- Consumes: schemas de `headset-types.ts`, `HeadsetService`, `VolumeControl`, `NotConnectedError`, `ReadOnlyError`, `RcspTimeoutError`, `RcspStatusError`.
- Produces:
  - `enum IpcErrorCode { NotConnected = 'not-connected', ReadOnly = 'read-only', InvalidInput = 'invalid-input', DeviceRejected = 'device-rejected', Timeout = 'timeout', Unknown = 'unknown' }`
  - `type IpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: IpcErrorCode; message: string } }`
  - `IPC_CHANNELS` (objeto `as const` com `{ request, response }` zod por canal): `headset:get-snapshot` (void → HeadsetSnapshot), `headset:set-anc` (AncSetting → void), `headset:apply-eq-preset` ({presetId} → void), `headset:apply-custom-eq` ({gainsDb: 10 inteiros −8..8} → void), `headset:rename` ({name} → void), `volume:get` (void → VolumeReading | null), `volume:set` ({percent 0..100} → void), `app:get-preferences` (void → {launchAtLogin}), `app:set-launch-at-login` ({enabled} → void); evento `headset:snapshot-changed`.
  - `type IpcChannel = keyof typeof IPC_CHANNELS`; `type IpcRequest<C>` / `IpcResponse<C>` inferidos do zod.
  - `interface QcyBridge { invoke<C extends IpcChannel>(channel: C, input: IpcRequest<C>): Promise<IpcResult<IpcResponse<C>>>; onSnapshot(listener: (snapshot: HeadsetSnapshot) => void): () => void }` + `declare global { interface Window { qcy: QcyBridge } }`
  - `type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>`
  - `registerIpcHandlers(deps: { ipcMain: IpcMainLike; isTrustedSender: (url: string) => boolean; sendToRenderer: (channel: 'headset:snapshot-changed', snapshot: HeadsetSnapshot) => void; headset: HeadsetService; volume: VolumeControl; preferences: { getLaunchAtLogin(): boolean; setLaunchAtLogin(enabled: boolean): void } }): () => void` (retorna a função que remove handlers e assinaturas)

- [ ] **Step 1: Testes que falham** (`IpcMainLike` falso):
  - `it('rejects requests from untrusted senders')` ⇒ `{ ok:false, error:{ code: Unknown } }` e o serviço não é chamado.
  - `it('returns invalid-input for a payload that fails the schema')` (ex.: `gainsDb` com 9 itens; `percent: 101`).
  - `it('maps NotConnectedError to not-connected')`, `ReadOnlyError` ⇒ `read-only`, `RcspTimeoutError` ⇒ `timeout`, `RcspStatusError` ⇒ `device-rejected`.
  - `it('forwards snapshot changes to the renderer')`.
  - `ipc-contract.test.ts`: `it('accepts every AncSetting variant and rejects unknown scenes')`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar**; preload expõe só `invoke` e `onSnapshot` via `contextBridge.exposeInMainWorld('qcy', …)`. **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat(ipc): add a typed, validated bridge between main and renderer`.

---

### Task 11: Base do renderer (queries, limites de erro, cabeçalho de conexão)

**Files:**
- Create: `src/renderer/src/api/qcy-bridge.ts`, `src/renderer/src/api/query-keys.ts`, `src/renderer/src/api/headset-queries.ts`, `src/renderer/src/components/query-boundary.tsx`, `src/renderer/src/components/connection-header.tsx`, `src/renderer/src/components/live-announcer.tsx`, `src/renderer/src/test/fake-bridge.ts`
- Modify: `src/renderer/src/app.tsx`, `src/renderer/src/copy/pt-br.ts`, `src/renderer/src/styles/*`
- Test: `connection-header.test.tsx`, `query-boundary.test.tsx`

**Interfaces:**
- Consumes: `QcyBridge`, `IpcResult`, `IpcErrorCode`, `HeadsetSnapshot`.
- Produces:
  - `class HeadsetApiError extends Error { readonly code: IpcErrorCode }`; `callBridge<C extends IpcChannel>(channel: C, input: IpcRequest<C>): Promise<IpcResponse<C>>` (lança `HeadsetApiError` quando `ok:false`)
  - `headsetKeys = { all: () => ['headset'], snapshot: () => ['headset', 'snapshot'] }`, `volumeKeys = { current: () => ['volume', 'current'] }`, `preferencesKeys = { all: () => ['preferences'] }`
  - `useHeadsetSnapshot(): HeadsetSnapshot` (`useSuspenseQuery` + assinatura de `onSnapshot` que faz `setQueryData`)
  - `QueryBoundary({ children }): JSX.Element` (`QueryErrorResetBoundary` + `ErrorBoundary` com botão `COPY.retry` + `Suspense` com `COPY.loading`)
  - `createFakeBridge(initial: HeadsetSnapshot): QcyBridge & { emitSnapshot(s: HeadsetSnapshot): void; calls: Array<{ channel: string; input: unknown }>; failNext(channel: IpcChannel, code: IpcErrorCode): void }`
- Textos (`COPY`): `searching: 'Procurando fone…'`, `connected: 'Conectado'`, `reconnecting: 'Desconectado — tentando de novo'`, `bluetoothOff: 'Bluetooth do PC desligado'`, `battery: (p) => \`Bateria ${p}%\``, `charging: 'carregando'`, `firmware: (v) => \`Firmware ${v}\``, `readOnly.unexpectedVendor: 'Este fone não parece ser um QCY H3. Os ajustes estão bloqueados por segurança.'`, `retry: 'Tentar de novo'`, `loading: 'Carregando…'`, `noHeadsetHelp: 'Ligue o fone e confira se o Bluetooth do PC está ligado.'`, `errors` (lookup por `IpcErrorCode`): `not-connected: 'Fone desconectado.'`, `read-only: 'Ajustes bloqueados para este fone.'`, `invalid-input: 'Valor inválido.'`, `device-rejected: 'O fone recusou o ajuste.'`, `timeout: 'O fone não respondeu a tempo.'`, `unknown: 'Algo deu errado.'`.

- [ ] **Step 1: Testes que falham:**
  - `it('shows name, connection, battery and firmware when connected')` ⇒ textos `QCY H3`, `Conectado`, `Bateria 30%`, `Firmware 0.1.2.3`.
  - `it('shows help while searching')`; `it('shows the read-only explanation')`.
  - `it('announces connection changes politely')` ⇒ região `role="status"`/`aria-live="polite"` recebe `Conectado`.
  - `query-boundary.test.tsx`: `it('offers a retry that refetches after an error')`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat(ui): render connection status from live headset snapshots`.

---

### Task 12: Painel de ANC

**Files:**
- Create: `src/renderer/src/components/anc-panel.tsx`
- Modify: `headset-queries.ts` (+ `useSetAnc()`), `copy/pt-br.ts`, `app.tsx`
- Test: `anc-panel.test.tsx`

**Interfaces:**
- Produces: `useSetAnc(): UseMutationResult<void, HeadsetApiError, AncSetting>`; `AncPanel(): JSX.Element`.
- Textos: grupo `Controle de ruído`: `Desligado`, `Transparência`, `Cancelamento de ruído`; grupo `Ambiente`: `Adaptativo`, `Ambiente barulhento`, `Deslocamento`, `Ambiente interno`, `Antivento`; grupo `Intensidade`: `Baixa`, `Média`, `Alta`.

- [ ] **Step 1: Testes que falham** (fake bridge):
  - `it('marks the current mode from the snapshot')`.
  - `it('turns on noise cancelling with the default scene')` ⇒ chamada `headset:set-anc` com `{mode:'noise-cancelling', scene:'noisy', level:'high'}`.
  - `it('shows intensity only for scenes that have levels')` (oculto em Adaptativo e Antivento).
  - `it('can be operated with the keyboard alone')` (Tab até o grupo, setas trocam a opção e enviam).
  - `it('disables every option when not connected or read-only')`.
  - `it('shows the error and a retry when the headset rejects the change')` (`failNext(..., NotConnected)` ⇒ mensagem `Fone desconectado` + `Tentar de novo`).
- [ ] **Step 2–4:** FAIL → implementar (rádios nativos em `<fieldset>`/`<legend>`) → PASS.
- [ ] **Step 5: Commit** `feat(ui): control noise cancelling modes and scenes`.

---

### Task 13: Painel de equalizador

**Files:**
- Create: `src/renderer/src/components/eq-panel.tsx`, `src/renderer/src/components/eq-slider.tsx`
- Modify: `headset-queries.ts` (+ `useApplyEqPreset()`, `useApplyCustomEq()`), `copy/pt-br.ts`, `app.tsx`
- Test: `eq-panel.test.tsx`

**Interfaces:**
- Consumes: `EqState`, `EqPresetId`, `CUSTOM_EQ_BAND_COUNT`, `EQ_GAIN_LIMIT_DB`, `CUSTOM_EQ_FREQUENCIES_HZ` (todos de `src/shared/headset-types.ts`).
- Produces: `EqPanel(): JSX.Element`; `EqSlider(props: { frequencyHz: number; gainDb: number; disabled: boolean; onChange(gainDb: number): void }): JSX.Element`; `formatFrequency(hz: number): string` (`55 Hz`, `1 kHz`, `1,8 kHz`, `22 kHz`); `formatGain(db: number): string` (`+3 dB`, `0 dB`, `−2 dB`).
- Textos: `Equalizador`, `Perfil`, perfis `Padrão`, `Pop`, `Graves`, `Rock`, `Suave`, `Clássico`, `Personalizado`; botões `Aplicar`, `Restaurar`.

- [ ] **Step 1: Testes que falham:**
  - `it('selects the preset reported by the headset')`.
  - `it('applies a preset only after Aplicar')` ⇒ nenhuma chamada ao trocar; `Aplicar` ⇒ `headset:apply-eq-preset {presetId: 4}` para Rock.
  - `it('switches to Personalizado when a slider moves and sends all ten gains')`.
  - `it('labels each slider with its frequency and spoken gain')` ⇒ `getByRole('slider', { name: '1 kHz' })` com `aria-valuetext="+3 dB"`.
  - `it('clamps sliders to ±8 dB with arrow keys')`.
  - `it('restores the headset values with Restaurar')`.
- [ ] **Step 2–4:** FAIL → implementar (`<input type="range" step="1">`, `<fieldset>`) → PASS.
- [ ] **Step 5: Commit** `feat(ui): choose EQ presets and edit a 10-band custom curve`.

---

### Task 14: Renomear e volume

**Files:**
- Create: `src/renderer/src/components/rename-dialog.tsx`, `src/renderer/src/components/volume-panel.tsx` (validação via `validateHeadsetName` de `src/shared/headset-name.ts`, a mesma usada pelo main)
- Modify: `headset-queries.ts` (+ `useRename()`, `useVolume()`, `useSetVolume()`), `copy/pt-br.ts`, `app.tsx`
- Test: `rename-dialog.test.tsx`, `volume-panel.test.tsx`

**Interfaces:**
- Produces: `RenameDialog(props: { open: boolean; onClose(): void }): JSX.Element`; `VolumePanel(): JSX.Element`; `VOLUME_DEBOUNCE_MS = 150`.
- Textos: `Renomear fone`, `Novo nome`, contador `(n) => \`${n}/31 bytes\``, `O nome não pode ficar vazio`, `Nome longo demais (máx. 31 bytes)`, `Salvar`, `Cancelar`, aviso pós-sucesso `O Windows pode mostrar o nome antigo até você parear o fone de novo.`; `Volume`, `O QCY H3 não está como saída de áudio do Windows.`

- [ ] **Step 1: Testes que falham:**
  - `it('counts bytes, not characters')` (emoji conta 4).
  - `it('blocks saving an empty or too long name and says why')`.
  - `it('saves a valid name and shows the Windows caching note')` ⇒ `headset:rename {name}`.
  - `it('closes with Escape and returns focus to the trigger')`.
  - `it('shows the H3 volume and sends changes after a short pause')` (fake timers, uma chamada `volume:set` após 150 ms de inatividade).
  - `it('explains when the H3 is not the audio output')`.
- [ ] **Step 2–4:** FAIL → implementar (`<dialog>` nativo com `showModal()`) → PASS.
- [ ] **Step 5: Commit** `feat(ui): rename the headset and adjust its volume`.

---

### Task 15: Bandeja, ciclo de vida e montagem do main

**Files:**
- Create: `src/main/tray/tray-menu.ts`, `src/main/tray/tray-controller.ts`, `resources/tray-icon.png`, `resources/icon.ico`
- Modify: `src/main/index.ts`, `src/main/app-window.ts`
- Test: `src/main/tray/tray-menu.test.ts`, `src/main/app-window.test.ts`

**Interfaces:**
- Consumes: `HeadsetService`, `AncSetting`, `DEFAULT_NOISE_CANCELLING`, `registerIpcHandlers`, `createWebBluetoothTransport`, `createFakeH3`, `createJsonSettingsStore`, `createWindowsVolumeControl`.
- Produces:
  - `buildTrayMenuTemplate(snapshot: HeadsetSnapshot, actions: { setAnc(setting: AncSetting): void; openWindow(): void; toggleLaunchAtLogin(): void; quit(): void }, launchAtLogin: boolean): MenuItemConstructorOptions[]`
  - `buildTrayTooltip(snapshot: HeadsetSnapshot): string` (`QCY H3 — 30%`, `QCY H3 — desconectado`)
  - `attachHideOnClose(window: BrowserWindow, isQuitting: () => boolean): void`
  - `index.ts`: transporte falso **somente** se `!app.isPackaged && process.env.QCY_TRANSPORT === 'fake'`; `eqFormat` vindo da Task 7.

- [ ] **Step 1: Testes que falham:**
  - `it('lists the three ANC modes as radio items with the current one checked')`; `it('turns on noise cancelling with the default scene from the tray')`; `it('disables ANC items while disconnected or read-only')`; `it('includes Abrir, Iniciar com o Windows and Sair')`.
  - `buildTrayTooltip` com e sem bateria.
  - `attachHideOnClose`: `it('hides instead of closing unless the app is quitting')` (janela falsa).
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5: Verificação manual** `pnpm dev` com `QCY_TRANSPORT=fake`: janela abre, fechar esconde na bandeja, menu da bandeja troca o ANC e a janela reflete.
- [ ] **Step 6: Commit** `feat(app): add tray quick controls and wire the main process`.

---

### Task 16: E2E com fone falso e acessibilidade

**Files:**
- Modify: `e2e/app.spec.ts`, `playwright.config.ts`, `package.json` (+ `@axe-core/playwright`, última versão, `-E`)
- Test: `e2e/app.spec.ts`

- [ ] **Step 1: Testes que falham** (`_electron.launch` com `env: { QCY_TRANSPORT: 'fake' }`):
  - `it('connects to the fake headset and shows its battery')`.
  - `it('changes ANC to Transparência and keeps it after the next poll')`.
  - `it('applies the Rock preset')` ⇒ após aplicar, o rádio `Rock` continua marcado depois de 4 s.
  - `it('has no automatic accessibility violations')` (axe, regras WCAG 2.x A/AA).
- [ ] **Step 2–4:** FAIL → corrigir o que faltar → `pnpm test:e2e` PASS.
- [ ] **Step 5: Commit** `test(e2e): cover the main flows against the fake headset`.

---

### Task 17: Empacotamento, fuses e aceite no fone real

**Files:**
- Create: `electron-builder.yml`, `scripts/apply-fuses.cjs`
- Modify: `package.json`
- Test: verificação por comandos

- [ ] **Step 1:** `electron-builder.yml`: `appId: digital.local.qcyh3control`, `productName: QCY H3 Control`, alvo `nsis` (`oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true`), `asarUnpack: ['node_modules/webbluetooth/**', 'node_modules/@webbluetooth/**']`, `extraResources: resources/volume-host.ps1`, `afterPack: scripts/apply-fuses.cjs`. Fuses: `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `GrantFileProtocolExtraPrivileges` off, `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on, `EnableCookieEncryption` on.
- [ ] **Step 2:** `pnpm dist` ⇒ gera `dist/QCY H3 Control Setup 0.1.0.exe` sem erros.
- [ ] **Step 3:** `npx @electron/fuses read --app "dist/win-unpacked/QCY H3 Control.exe"` ⇒ valores do Step 1.
- [ ] **Step 4: ⛔ PONTO DE PARADA — aceite com o dono.** Instalar e percorrer com o dono os critérios do spec §7: conecta sozinho em até 10 s; ANC pelo app e pelo botão físico (≤ 3 s); perfil e EQ personalizado audíveis e relidos após reabrir; renomear; música sem interrupção; desligar/religar ⇒ reconecta; volume. Registrar o resultado em `docs/acceptance-2026-10.md`.
- [ ] **Step 5: Commit** `build: package QCY H3 Control as a hardened NSIS installer`.
