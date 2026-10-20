# H3 Control

Unofficial Windows desktop app for the **QCY H3** headphones. It controls noise cancelling, the equalizer, the headset name and the volume over Bluetooth LE, without the phone app.

> [!IMPORTANT]
> H3 Control is an independent project. It is not made, endorsed or supported by QCY. "QCY" and "H3" are trademarks of their owners and appear here only to name the headphones this app works with.

## Features

- **Noise control**: off, transparency, or noise cancelling with scene (adaptive, noisy, commuting, indoor, anti-wind) and intensity.
- **Equalizer**: the six factory presets, plus a 10-band custom EQ (±8 dB).
- **Battery and firmware** readout. Battery and noise control refresh every 3 seconds.
- **Rename** the headset.
- **Volume**: controls the Windows output volume for the headset.
- **System tray**: switch noise control, open the window, or quit. The app keeps running in the tray when you close the window, and can start with Windows.
- **Automatic connection**: finds the headset, connects, and reconnects with backoff after it drops.

The interface is in Brazilian Portuguese.

## Safety

The app writes settings to the headset, so it is built to fail safe:

- It can only build an allowlist of known commands. It never sends reset, unpair, reboot or firmware-update frames. See the do-not-send list in the [protocol notes](docs/protocol/qcy-h3-rcsp.md#8-do-not-send-list-destructive-or-state-changing).
- If the connected device does not identify as a QCY H3, every setting is locked and the app only reads.
- The app never accesses the internet. It talks only to the headset.

It still comes with no warranty. Use it at your own risk.

## Requirements

- Windows 10 or 11
- A Bluetooth adapter with Bluetooth LE support
- QCY H3 headphones paired with the PC (firmware 0.9.1.2 is the tested version)

To build from source you also need [Node.js](https://nodejs.org/) (tested with 24) and [pnpm](https://pnpm.io/) (tested with 10).

## Installation

There are no prebuilt releases yet. Build the installer from source:

```sh
git clone https://github.com/tsnery/h3-control.git
cd h3-control
pnpm install
pnpm dist
```

This writes `dist/H3 Control Setup 0.1.0.exe`. The first run needs internet access to download the Electron, NSIS and 7-Zip tooling.

The installer is not code-signed, so Windows SmartScreen may warn you before it runs.

## Usage

1. Turn on the headphones and make sure Bluetooth is on.
2. Open H3 Control. It finds and connects to the headset by itself.
3. Change noise control, EQ, name or volume in the window, or right-click the tray icon for quick noise-control switching.

Windows may keep showing the old name after a rename until you pair the headset again.

## Development

```sh
pnpm install
pnpm dev
```

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the app with hot reload |
| `pnpm build` | Builds the main, preload and renderer bundles into `out/` |
| `pnpm typecheck` | Type-checks the Node and web projects |
| `pnpm lint` | Runs ESLint |
| `pnpm test` | Runs the unit tests (Vitest) |
| `pnpm test:e2e` | Builds the app and runs the end-to-end tests (Playwright) against a simulated headset |
| `pnpm probe -- --stage a\|b\|eq` | Runs a staged hardware probe against a real headset and records the frames in `probe-output/` |
| `pnpm dist` | Builds the Windows installer |

**Simulated headset.** Set `QCY_TRANSPORT=fake` to run against a fake headset that replays real captures. This only works in development; the packaged app always uses real Bluetooth. Do not launch the packaged app on a PC paired with an H3 unless you mean to connect to it.

**Missing Electron binary.** On a clean clone, pnpm may skip Electron's postinstall step, so `node_modules/electron/dist` is missing. `pnpm dev` and `pnpm test:e2e` need it. Fix it with `node node_modules/electron/install.js`. `pnpm dist` is not affected.

### Project structure

```
src/
  main/        Electron main process
    rcsp/      RCSP frame encoding, stream parser, request/response client
    h3/        H3 commands: ANC, EQ, model checks
    headset/   Connection lifecycle, polling, reconnection
    transport/ Bluetooth LE transport, plus the fake headset and its captures
    volume/    Windows output volume
    tray/      Tray menu
    ipc/       Validated IPC handlers
  preload/     Bridge exposed to the renderer
  renderer/    React UI
  shared/      Types, schemas and EQ presets shared by both sides
docs/protocol/ Protocol notes
e2e/           Playwright tests
scripts/       Hardware probe and build hooks
```

## Protocol

The headset speaks Jieli RCSP over Bluetooth LE, with QCY-specific TLVs for noise control and EQ. [`docs/protocol/qcy-h3-rcsp.md`](docs/protocol/qcy-h3-rcsp.md) documents the frames, what was confirmed on hardware, and the commands that must never be sent.

## Contributing

Issues and pull requests are welcome. Before you open a pull request, run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm test:e2e`.

Never send a command from the do-not-send list to a real headset, not even while testing.

## License

[MIT](LICENSE) © Tainan Nery
