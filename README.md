# H3 Control

Unofficial Windows desktop control for the QCY H3 headphones: noise control, EQ, rename and battery over Bluetooth LE.

> **Not affiliated with QCY.** This is an independent project. It is not made, endorsed or supported by QCY. "QCY" and "H3" are trademarks of their owners and are used here only to name the headphones this app works with.
>
> **Use at your own risk.** The app writes settings to the headset. It never sends reset, unpair, reboot or firmware-update commands (see [`docs/protocol/qcy-h3-rcsp.md`](docs/protocol/qcy-h3-rcsp.md) §8), but it comes with no warranty. See [LICENSE](LICENSE).

## Build

```
pnpm install
pnpm dist
```

`pnpm dist` writes `dist/H3 Control Setup 0.1.0.exe` and `dist/win-unpacked/`. It needs internet on first run to download the Electron, NSIS and 7zip tooling. Installer is unsigned.

On a clean clone, pnpm may not run the electron postinstall, so `node_modules/electron/dist` is missing. `pnpm dist` is not affected (electron-builder downloads its own Electron). `pnpm dev` and `pnpm test:e2e` need it. Fix: `node node_modules/electron/install.js`.

Do not launch the packaged app on a machine with a paired QCY H3 unless you intend to connect to it: the fake transport is disabled when packaged.

## License

[MIT](LICENSE)
