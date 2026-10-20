# QCY H3 Control — design

Data: 2026-10-19 · Status: aguardando aprovação do dono

## 1. Intenção

O fone **QCY H3** só pode ser configurado pelo app QCY de celular. O dono usa o fone no PC com Windows 11 e quer ajustar o fone ali mesmo, sem pegar o celular: trocar o modo de cancelamento de ruído (ANC), escolher ou personalizar a equalização, renomear o fone e ver bateria e volume.

O app é um painel de controle de desktop que fala com o fone pelo mesmo protocolo do app oficial. Ele não inventa comandos.

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos (v1)**

1. Encontrar e conectar sozinho ao fone (sem escolher dispositivo numa lista) e reconectar quando ele voltar.
2. Mostrar estado: conectado ou não, bateria (%) e versão do firmware.
3. ANC: Desligado, Transparência e Cancelamento de ruído com cenas (Adaptativo, Ambiente barulhento, Deslocamento, Ambiente interno — cada um com nível baixo/médio/alto — e Antivento). Refletir mudanças feitas pelo botão físico.
4. Equalizador: 6 perfis prontos (Padrão, Pop, Graves, Rock, Suave, Clássico) e um perfil personalizado de 10 bandas.
5. Renomear o fone.
6. Volume: um controle de volume do fone.
7. Ícone na bandeja do sistema com troca rápida de modo de ANC, funcionando com a janela fechada.
8. Interface em português do Brasil.

**Não-objetivos (v1)**

- Atualização de firmware (OTA), reset de fábrica, limpar pareamentos, remapear botões, LEDs, modo jogo, balanço de canais.
- Outros modelos QCY. O código deve deixar espaço para eles (camada de protocolo separada da de modelo), mas só o H3 (vendorId 16755 e 16760) é suportado.
- macOS e Linux. Auto-update. Assinatura de código (v1 sai sem assinatura).
- Conta QCY, login ou qualquer funcionalidade de nuvem do app oficial.

**Anti-objetivos (falha mesmo que "funcione")**

- Enviar qualquer comando da lista "NÃO ENVIAR" do protocolo (§8 da referência). Um bug que reseta, despareia ou trava o fone é a pior falha possível.
- Atrapalhar o áudio: o app nunca pode derrubar a conexão de áudio Bluetooth clássico do fone com o PC.
- Exigir troca de driver do adaptador Bluetooth (ex.: WinUSB/Zadig) ou privilégios de administrador.
- Enviar dados do usuário para qualquer serviço externo.

## 3. Contexto técnico já comprovado

A referência completa do protocolo, com o nível de evidência de cada fato, está em [`docs/protocol/qcy-h3-rcsp.md`](../../protocol/qcy-h3-rcsp.md). Fatos-chave:

- O H3 expõe um **segundo periférico BLE** chamado `QCY H3-APP`. Ele anuncia dados de fabricante com company ID `0x521C`; bytes 0–1 = vendorId big-endian (`0x4173` = 16755), byte 5 = bateria (bit 7 = carregando).
- Controle via **Jieli RCSP** no serviço GATT `0000a002-…`, escrita em `00000001-…`, notificação em `00000002-…`.
- Quadro: `FE DC BA | flag | opcode | len (u16 BE) | corpo | EF`. Comandos do host usam flag `C0`. Respostas casam por (opcode, sn); timeout 2 s, até 3 reenvios.
- ANC e EQ são TLVs da QCY dentro do opcode `0xFF`. Nome e bateria usam opcodes nativos Jieli `0xC0`/`0xC1`. Versão do firmware vem do GetTargetInfo (`0x03`).
- Não há autenticação. Após ligar as notificações, o app oficial envia GetTargetInfo e sincronização de hora.
- Volume: o app oficial não usa RCSP para volume; deixa para o volume de áudio do sistema (AVRCP).
- O áudio (A2DP) usa um endereço clássico diferente do periférico BLE. Projetos open source controlam o H3 por BLE no Windows com o áudio tocando.

- **Perfis de fábrica do H3**: as curvas dos seis perfis e o Q das bandas do EQ personalizado ficam embutidos em `src/shared/eq-presets.ts`. O app em execução **nunca** acessa a internet.

Lacunas conhecidas (§9 da referência): formato exato das respostas de leitura e do aviso do botão físico; tipo de escrita GATT; MTU real; se é preciso o comando `0x0B 00 00` antes dos demais; versão real do firmware do fone do dono (decide entre `0x20` e `0x22`).

## 4. Decisões de como construir

### 4.1 Stack (decisão do Claude; o dono delegou a escolha)

| Item | Escolha | Por quê |
|---|---|---|
| Shell desktop | **Electron 44** + **electron-vite 6** + **electron-builder 26** (instalador NSIS) | Stack TS/React do dono; Node 24 e pnpm já instalados; sem Rust nem .NET SDK na máquina |
| UI | **React** + **TypeScript** estrito, **TanStack Query** com `useSuspenseQuery`, error boundaries com "tentar de novo" | Regras do CLAUDE.md do dono |
| BLE | Pacote npm **`webbluetooth` 7.1.0** (btleplug/WinRT via napi-rs, binário pronto `win32-x64-msvc`) rodando no **processo principal** (ou `utilityProcess`) | Sem gesto do usuário nem janela de escolha; reconecta sozinho; bandeja funciona sem janela. O Web Bluetooth do Chromium no renderer exige gesto, não reconecta após reiniciar e tem bugs de pareamento abertos no Windows (Electron #52743, #52837) |
| Testes | **Vitest** (protocolo e lógica), **React Testing Library**, **Playwright** `_electron` (fluxos ponta a ponta com transporte falso) | |
| Pacotes | **pnpm** | |

Limitação aceita: nem `webbluetooth` nem o Web Bluetooth do Chromium leem dados de fabricante do anúncio. A bateria vem por RCSP (`C1`).

**Identificação do fone (decisão do Claude):** só conecta a periféricos com nome **exatamente** `QCY H3-APP` (rejeita `QCY H3 Pro-APP`, `QCY H3S-APP` etc.) que exponham o serviço `0000a002`. Após o GetTargetInfo, confere VID `0x05D6` (Jieli, tipo 10). O endereço BLE do primeiro fone conectado com sucesso é lembrado e preferido nas próximas vezes. Se alguma conferência falhar, o app fica em **modo somente leitura** (mostra o estado, desabilita escritas) e explica o motivo.

### 4.2 Arquitetura em camadas

```
renderer (React)  ──IPC tipado (contextBridge + zod)──>  main
                                                          ├─ headset-service   (estado, polling, regras de negócio)
                                                          ├─ h3-model          (tabelas ANC/EQ, limites, mapeamento UI→bytes)
                                                          ├─ rcsp              (codificar/decodificar quadros, parser de fluxo, casamento sn, timeout/reenvio)
                                                          └─ transport         (interface; impl webbluetooth; impl falsa p/ testes)
```

- **`transport`**: interface pequena (`connect`, `write(bytes)`, stream de notificações, evento de desconexão). Duas implementações: `webbluetooth` (real) e falsa em memória que reproduz quadros capturados. Trocável por variável de ambiente para testes.
- **`rcsp`**: código puro, sem I/O. Parser de fluxo que ressincroniza em `FE DC BA`, confere `EF`, aceita vários quadros por notificação e quadros partidos (§4.3 da referência). Fila serializada: uma escrita GATT por vez, um quadro por escrita.
- **Lista de comandos permitidos**: a camada `rcsp`/`h3-model` só sabe construir os quadros da tabela da §5. Não existe função genérica "enviar bytes". Opcodes da lista NÃO ENVIAR (`C5`, `E7`, `E1–E8`, `06`, `0B 01`, TLVs `01/02/03 00` etc.) são impossíveis de construir, e há testes que provam isso.
- **IPC**: um mapa único de canais com tipos de requisição/resposta compartilhados por main, preload e renderer; validação com zod no main; `sender` validado. O renderer usa TanStack Query sobre esse IPC (chaves de cache por fábrica, nunca strings soltas). O main empurra eventos (conectou, bateria, ANC mudou) e o renderer invalida/atualiza as queries.
- **Segurança Electron**: `contextIsolation`, `sandbox`, `nodeIntegration: false`, CSP `script-src 'self'`, navegação e novas janelas bloqueadas, fuses (RunAsNode off, NodeOptions off, inspect off, ASAR integrity on, OnlyLoadAppFromAsar on), instância única.

### 4.3 Sessão com o fone

1. Procurar o periférico com nome começando por `QCY H3` e serviço `0000a002`.
2. Conectar, ligar notificações em `00000002`.
3. Enviar GetTargetInfo (`03`, máscara `FFFFFFFF`). Se não houver resposta em 2 s (com os reenvios), enviar `0B 00 00` e tentar de novo. **Nunca** `0B 01`.
4. Enviar a sincronização de hora (`C0` tipo 7), como o app oficial.
5. Ler estado: bateria (`C1 00000D21`), ANC (`FF FE 01 17`), EQ (`FF FE 01 22`), nome (`C1` tipo 1).
6. A cada 3 s, com a janela aberta ou a bandeja ativa, ler bateria e ANC (o app oficial faz polling para este vendorId). Também tratar avisos espontâneos (`FF` com TLV `17`, `C2`, `C4`). Ignorar avisos de ANC por 1 s após o próprio app trocar o ANC.
7. Na desconexão: reconectar com backoff exponencial (1 s → 30 s), sem travar a UI.

### 4.4 Funcionalidades e bytes

| Funcionalidade | Envio | Observações |
|---|---|---|
| ANC | `FF` + `17 03 MM SS LL` (tabela §6.1 da referência) | Padrão ao tocar "Cancelamento de ruído": Ambiente barulhento alto (`01 01 02`) |
| Perfil de EQ | `FF` + TLV `20` (ver nota) `<n×6+3> IDX MG <n bandas>` com as bandas do perfil oficial (7 ou 8), sem completar até 10 | IDX = posição 1..6. Curvas na tabela abaixo |
| EQ personalizado | `FF` + TLV `20` `3F IDX MG <10 bandas>` em 55/220/500/1000/1800/2800/4500/7500/10000/22000 Hz, Q = 0.4/1.2/1.5/1.5/1.2/0.8/1.2/1.2/1.2/1.2 | IDX = `0xFF` na primeira escrita personalizada, `0x80` depois (lembrado localmente). Sliders inteiros de −8 a +8 dB. Ganho mestre: −5,5 dB menos o maior reforço positivo (decisão do Claude; o app oficial calcula algo parecido). Como no app oficial, o personalizado parte da curva do último perfil, arredondada e limitada a ±8 dB (decisão do dono) |

**Nota sobre `0x20` vs `0x22`:** `0x22` usa banda de 7 bytes, com tipo de filtro; `0x20` usa banda de 6 bytes (freq u16 LE, ganho s16 LE ×100, Q u16 LE ×100). A camada `h3-model` escolhe pelo par (vendorId, firmware) e a sonda confirma lendo `FE 01 20` / `FE 01 22`.

**Perfis de fábrica do H3** (ganho em dB / Q; ganho mestre por perfil):

| Perfil (IDX) | Mestre | 55 Hz | 220 | 500 | 1000 | 1800 | 2800 | 4500 | 7500 |
|---|---|---|---|---|---|---|---|---|---|
| Padrão (1) | −5,5 | +2,5/0,4 | −11/0,8 | +1/0,7 | — | +2,5/1,0 | +3/0,8 | +2/1,3 | +2,5/1,2 |
| Pop (2) | −5,5 | −3/0,4 | −12/1,2 | +1/1,5 | −1/1,5 | +2/1,2 | +3,5/0,8 | — | +3/1,2 |
| Graves (3) | −5 | +6/0,4 | −9/1,2 | +1/1,5 | −1/1,5 | −3,5/0,9 | 0/0,7 | — | −4/0,5 |
| Rock (4) | −5,5 | +5,5/0,4 | −10/0,7 | 0/0,7 | −1/1,5 | +1,5/0,7 | +4/0,8 | +3/0,7 | +3/0,7 |
| Suave (5) | −5,5 | −1/0,7 | −12/1,2 | +1/1,5 | −1/1,5 | +2/1,2 | +2/0,8 | — | +2/1,2 |
| Clássico (6) | −5,5 | +4/0,4 | −5/1,5 | +1/1,5 | +2/0,7 | +2/1,2 | +2/0,8 | — | +3/1,2 |

"—" = banda ausente no perfil (não é enviada). A fonte de verdade é o JSON; a tabela é para leitura.
| Renomear | `C0` + `<N+1> 01 <UTF-8>` | Máx. 31 bytes UTF-8, sem espaços nas pontas, não vazio. Avisar que o Windows pode manter o nome antigo até reparear |
| Bateria | `C1 00 00 0D 21` | Mostrar % e se está carregando |
| Firmware | GetTargetInfo tipo 5 | Exibir `a.b.c.d` |
| Volume | Volume do endpoint de áudio do Windows correspondente ao fone (o que o AVRCP já sincroniza) | Ver §6. Não usar RCSP para volume |

## 5. Interface

- **Janela principal** (uma página): cabeçalho com nome do fone, estado da conexão, bateria e versão; seção ANC; seção Equalizador; seção Volume; ação "Renomear" num diálogo.
- **ANC**: grupo de rádio (Desligado / Transparência / Cancelamento de ruído). Ao escolher Cancelamento, um segundo grupo com as cenas e, quando houver, o nível.
- **EQ**: seletor de perfil + 10 sliders verticais (rótulo da frequência, `aria-valuetext` "+3 dB"), que mostram a curva do perfil ativo ou escolhido (slider limitado a ±8 dB; texto com o valor real, ex. "−12 dB"), botão "Aplicar" e "Restaurar". Mudanças só vão ao fone ao aplicar (evita inundar o fone com escritas).
- **Bandeja**: ícone com tooltip (nome + bateria), menu com itens de rádio para ANC (Desligado / Transparência / Cancelamento), "Abrir" e "Sair". Fechar a janela esconde para a bandeja. Opção "Iniciar com o Windows" (desligada por padrão).
- **Estados**: "Procurando fone…", "Conectado", "Desconectado — tentando de novo", erros com botão "Tentar de novo". Sem fone, a UI mostra instruções (ligar o fone, Bluetooth do PC ligado).
- **Acessibilidade** (WCAG 2.2 AA, que inclui 2.0): controles nativos (`<input type="radio">`, `<input type="range">`) em `<fieldset>`/`<legend>`; navegação completa por teclado; foco visível; contraste 4,5:1; região `aria-live="polite"` para conexão, bateria e mudanças de ANC; respeitar `prefers-reduced-motion` e `forced-colors`.
- Tema claro/escuro seguindo o Windows.

## 6. Pendências com dono decidido ou a decidir

| # | Pendência | Situação |
|---|---|---|
| 1 | Curvas dos 6 perfis de EQ do H3 | **Resolvida:** ver §4.4 e `src/shared/eq-presets.ts` |
| 2 | Q e tipo de filtro das bandas do EQ personalizado | **Resolvida:** Q dos perfis de fábrica; `0x20` não leva tipo de filtro (§4.4) |
| 3 | Volume do endpoint do Windows exige acesso à API de áudio (Core Audio) a partir do Node | Decisão do Claude: helper pequeno e testável (ex.: pacote npm mantido com binário pronto, ou script PowerShell Core Audio) escolhido no plano; se nenhum for confiável, o slider de volume sai da v1 e fica o atalho para o volume do Windows |
| 4 | Lacunas de protocolo (formato das respostas, aviso do botão, tipo de escrita, MTU, `0B 00 00`, firmware real) | **Ponto de parada com o dono (decisão do dono):** ver §6.1 |

### 6.1 Sonda de hardware (ponto de parada obrigatório)

Logo depois das camadas `transport` e `rcsp` existirem com testes, o trabalho **para** e o dono é chamado para ligar o fone e autorizar a sonda. Antes de rodar, o dono vê a lista exata de quadros que serão enviados.

- **Etapa A (leitura e preparação da sessão):** conectar ao `QCY H3-APP`, ligar notificações, GetTargetInfo, `C1` bateria, `FE 01 17` (ANC), `FE 01 20` e `FE 01 22` (EQ), `C1` tipo 1 (nome). A sincronização de hora (`C0` tipo 7) e, só se o GetTargetInfo não responder, `0B 00 00` fazem parte da sessão do app oficial e entram na lista mostrada ao dono. Registrar: MTU negociado, tipo de escrita aceito, todos os quadros brutos (viram fixtures), versão do firmware.
- **Etapa B (escrita reversível):** ler o ANC atual, trocar para Transparência, conferir pelo ouvido e pela leitura, voltar ao modo original. Pedir ao dono que aperte o botão físico de ANC enquanto a sonda registra (captura o formato do aviso).
- **Se o firmware for > 0.8.0.7999:** reavaliar `0x20`/`0x22` antes de seguir.
- **Fallbacks:** com `0x20`, o maior quadro (EQ personalizado, 10 bandas) tem 74 bytes e exige ATT MTU ≥ 77; perfis de 8 bandas exigem ≥ 65 (com `0x22`: 84 bytes / MTU ≥ 87). Se o MTU não comportar, a v1 sai sem o que não couber e o dono é avisado. `webbluetooth` não conecta com o áudio tocando ou exige pareamento BLE → parar e voltar ao dono com as opções (`@stoprocent/noble` via WinRT é o plano B de transporte). Qualquer resposta com status de erro a um comando de escrita → não insistir; registrar e voltar ao dono.

## 7. Critérios de pronto

- Com o fone ligado e o app aberto, conecta sozinho em até 10 s e mostra bateria e versão.
- Trocar o ANC no app muda o som do fone; trocar no botão físico atualiza o app em até 3 s.
- Escolher um perfil e aplicar um EQ personalizado muda o som; reabrir o app mostra o EQ atual lido do fone.
- Renomear muda o nome lido de volta pelo app.
- A música no PC não é interrompida em nenhum desses passos.
- Desligar e religar o fone: o app reconecta sozinho.
- Testes: protocolo e modelo cobertos por Vitest (incluindo "não constrói comandos proibidos"); componentes com RTL; um fluxo Playwright com transporte falso; tudo verde.
- Instalador NSIS gerado e app instalado funciona fora do modo dev.

## 8. O que fica a cargo de quem constrói

Estrutura interna de pastas, nomes de componentes, biblioteca de ícones, visual detalhado, estratégia exata de backoff, helper de volume (dentro da regra da pendência 3) e a forma de gerar o ícone da bandeja — seguindo as regras do CLAUDE.md do dono (TS estrito sem `any`, exports nomeados, arquivos kebab-case, React Query + Suspense, sem fetch em `useEffect`, testes descrevendo comportamento, sem comentários óbvios).
