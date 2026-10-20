import type { ConnectionStatus } from '../../../shared/headset-types'
import { HEADSET_NAME_MAX_BYTES } from '../../../shared/headset-name'
import type { IpcErrorCode } from '../../../shared/ipc-contract'

const ERRORS: Record<IpcErrorCode, string> = {
  'not-connected': 'Fone desconectado.',
  'read-only': 'Ajustes bloqueados para este fone.',
  'invalid-input': 'Valor inválido.',
  'device-rejected': 'O fone recusou o ajuste.',
  timeout: 'O fone não respondeu a tempo.',
  'output-unavailable': 'O QCY H3 não está como saída de áudio do Windows.',
  unknown: 'Algo deu errado.',
}

export const COPY = {
  appName: 'H3 Control',
  searching: 'Procurando fone…',
  connecting: 'Conectando…',
  connected: 'Conectado',
  reconnecting: 'Desconectado — tentando de novo',
  bluetoothOff: 'Bluetooth do PC desligado',
  battery: (percent: number) => `Bateria ${percent}%`,
  charging: 'carregando',
  firmware: (version: string) => `Firmware ${version}`,
  gameMode: {
    on: 'Modo jogo',
    off: 'Modo jogo desligado',
  },
  readOnly: {
    unexpectedVendor: 'Este fone não parece ser um QCY H3. Os ajustes estão bloqueados por segurança.',
  },
  retry: 'Tentar de novo',
  loading: 'Carregando…',
  noHeadsetHelp: 'Ligue o fone e confira se o Bluetooth do PC está ligado.',
  anc: {
    modeGroup: 'Controle de ruído',
    sceneGroup: 'Ambiente',
    levelGroup: 'Intensidade',
    modes: {
      off: 'Desligado',
      transparency: 'Transparência',
      'noise-cancelling': 'Cancelamento de ruído',
    },
    scenes: {
      adaptive: 'Adaptativo',
      noisy: 'Ambiente barulhento',
      commuting: 'Deslocamento',
      indoor: 'Ambiente interno',
      'anti-wind': 'Antivento',
    },
    levels: { low: 'Baixa', medium: 'Média', high: 'Alta' },
  },
  eq: {
    title: 'Equalizador',
    presetLabel: 'Perfil',
    chooseProfile: 'Escolha um perfil',
    bandsGroup: 'Bandas',
    presets: {
      1: 'Padrão',
      2: 'Pop',
      3: 'Graves',
      4: 'Rock',
      5: 'Suave',
      6: 'Clássico',
    },
    custom: 'Personalizado',
    apply: 'Aplicar',
    restore: 'Restaurar',
  },
  rename: {
    trigger: 'Renomear',
    title: 'Renomear fone',
    nameLabel: 'Novo nome',
    bytes: (count: number) => `${count}/${HEADSET_NAME_MAX_BYTES} bytes`,
    invalid: {
      empty: 'O nome não pode ficar vazio',
      'too-long': `Nome longo demais (máx. ${HEADSET_NAME_MAX_BYTES} bytes)`,
    },
    save: 'Salvar',
    cancel: 'Cancelar',
    close: 'Fechar',
    cachingNote: 'O Windows pode mostrar o nome antigo até você parear o fone de novo.',
    blockedByGameMode: 'Para renomear, desligue o modo jogo no fone.',
  },
  volume: {
    title: 'Volume',
    percent: (value: number) => `${value}%`,
  },
  errors: ERRORS,
} as const

export const STATUS_TEXT: Record<ConnectionStatus, string> = {
  searching: COPY.searching,
  connecting: COPY.connecting,
  connected: COPY.connected,
  reconnecting: COPY.reconnecting,
  'bluetooth-off': COPY.bluetoothOff,
}
