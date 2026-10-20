# QCY H3 over BLE: Jieli RCSP protocol notes

Target device: **QCY H3**, product id **16755 (0x4173)**. Sibling SKU 16760 (0x4178) is mentioned where public sources cover it.

These are independent interoperability notes. They describe the bytes the headset accepts and returns, so that a desktop app can control a headset the user owns. This project is not affiliated with or endorsed by QCY. QCY is a trademark of its owner.

## 0. Conventions

- **OBSERVED**: seen on the owner's H3 (firmware 0.9.1.2). The raw captures are in `src/main/transport/fixtures/`.
- **CAPTURED**: seen in public BLE captures of an **H3 Pro** (product id 16759) published in [HusnainTaj/qcy-h3-pro-ble-controller](https://github.com/HusnainTaj/qcy-h3-pro-ble-controller) (`packets.txt`).
- **PUBLIC**: described by open-source projects that drive the H3 or other Jieli headsets: [GMarzochi/QCY_H3_WindowsEdition](https://github.com/GMarzochi/QCY_H3_WindowsEdition), [lucianothesilva/qcy-menubar](https://github.com/lucianothesilva/qcy-menubar), [hui1601/Quicky](https://github.com/hui1601/Quicky), or by Jieli RCSP conventions.
- **UNVERIFIED**: believed true but never seen on an H3. Do not rely on it without a hardware test.
- Hex is shown MSB-first, as it appears on the wire. `ss` = sequence number byte. `LL LL` = big-endian length.

---

## 1. Key facts (read this first)

1. **Two command families.** Name, game mode, balance, battery and time use **Jieli ADV opcodes 0xC0/0xC1**. ANC and the multi-band EQ use **QCY TLVs carried inside opcode 0xFF**.
2. **There is no authentication or handshake.** After notifications are on, GetTargetInfo (0x03) answers on the first try (OBSERVED).
3. **NotifyCommunicationWay (0x0B) is not needed** on firmware 0.9.1.2 (OBSERVED), although two hobby projects send `0B 00 00` first. Never send it with way = 1: that switches the link to SPP for firmware updates.
4. **ANC** is opcode 0xFF + TLV `17 03 <mode> <scene> <level>`. Read it back with `FE 01 17` (OBSERVED).
5. **EQ** is opcode 0xFF + TLV 0x22 with exactly 10 parametric bands. Each band is `freq u16LE, gain s16LE ×100, Q u16LE ×100, filterType u8` (OBSERVED write and read-back).

---

## 2. Identification and advertisement

| Item | Value | Status |
|---|---|---|
| Manufacturer-data company ID | `0x521C` | OBSERVED |
| BLE peer used for control | The LE address that advertises 0x521C data. Its name is `QCY H3-APP` | OBSERVED |
| Audio (A2DP) | Uses a separate classic BR/EDR address. BLE control works while music plays | OBSERVED |

Manufacturer-data layout (bytes after the company ID):

| Offset | Meaning | Encoding | Status |
|---|---|---|---|
| 0-1 | product id | **big-endian** u16 (`41 73` = 16755) | OBSERVED |
| 3 | color index | `(b & 0x0E) >> 1` | UNVERIFIED |
| 5 | headset battery | bit7 = charging, bits0-6 = % (1..100) | OBSERVED (`1E` = 30 %, not charging) |
| 6, 7 | second bud, case | same encoding; 0 on the H3 | OBSERVED as 0 |
| 11..16 | classic (BR/EDR) MAC, scrambled | MAC = `[12]:[11]:[13]:[16]:[15]:[14]` | OBSERVED (matched the BR/EDR address) |
| 18..23 | other-ear MAC; zero means "same as above" | same scramble | OBSERVED as zeros |

The H3 is a single headset, not a TWS pair, so only one battery value is meaningful.

---

## 3. GATT transport

| Item | Value | Status |
|---|---|---|
| Service | `0000A002-0000-1000-8000-00805f9b34fb` | OBSERVED |
| Write characteristic | `00000001-0000-1000-8000-00805f9b34fb` | OBSERVED |
| Notify characteristic | `00000002-0000-1000-8000-00805f9b34fb` | OBSERVED |
| Writes | One RCSP frame per GATT write, serialised | OBSERVED (works); splitting a frame across writes is UNVERIFIED |
| Write type | Write Without Response when the characteristic allows it, otherwise Write With Response | PUBLIC; works on the owner's H3 |

**MTU requirement:** the largest frame is the EQ write at 84 bytes, so the negotiated ATT MTU must be ≥ 87. Do not rely on the device reassembling a frame split across writes.

---

## 4. RCSP framing

### 4.1 Frame layout

```
FE DC BA | flag | opcode | paramLen(2, BE) | body[paramLen] | EF
```

The body depends on the frame type:

- **Command frame** (flag bit7 = 1): `body = sn(1) | [xmOpCode(1) only if opcode == 0x01] | payload`
- **Response frame** (flag bit7 = 0): `body = status(1) | sn(1) | [xmOpCode if opcode == 0x01] | payload`

| Field | Detail |
|---|---|
| Prefix | `FE DC BA` |
| End | `EF` |
| flag | bit7 = type (1 = command, 0 = response). bit6 = hasResponse (the command expects a reply). Host commands use `C0`; responses use `00` |
| opcode | 1 byte |
| paramLen | **big-endian u16** counting every body byte, including sn and status |
| Total frame length | `paramLen + 8` |
| sn | u8. Increments per command and wraps 255 → 0. A resend keeps the same sn |
| status (responses only) | 0 success, 1 fail, 2 unknown cmd, 3 busy, 4 no resource, 5 CRC error, 6 all-data CRC error, 7 parameter error, 8 response data over limit |
| Payload limit | 530 bytes. Drop frames with a larger `paramLen` |

Worked example (CAPTURED, game mode on):

```
TX: FE DC BA C0 C0 00 04 70 02 05 02 EF
    flag=C0 (cmd, wants reply), op=0xC0 SetADV, len=4, sn=0x70, payload 02 05 02
RX: FE DC BA 00 C0 00 03 00 70 00 EF
    flag=00 (response), op=0xC0, len=3, status=00, sn=0x70, payload 00 (SetADV result 0 = OK)
```

### 4.2 Request/response matching, timeouts and retries

- Match a response to its request by **(opcode, sn)**.
- Use a 2000 ms timeout. Every OBSERVED response arrived in 20 to 120 ms.
- Device-initiated frames are commands (flag bit7 = 1). Do not reply to them.

### 4.3 Reassembly of split or merged notifications

For each notification:

1. Prepend any cached bytes to the new data.
2. Scan for `FE DC BA`. If the prefix or the 4 header bytes after it are incomplete, cache from the prefix onward and wait.
3. Read the BE length. If `paramLen > 530`, skip.
4. If `paramLen + 8` bytes are not all present, cache from the prefix and wait.
5. If the byte at the end position is not `EF`, advance one byte and rescan.
6. A single notification may carry several frames. Extract all of them.

### 4.4 Opcodes

| Op | Name | Used by this app? |
|---|---|---|
| 0x01 | Data (has xmOpCode) | no |
| 0x03 | GetTargetInfo | **yes**, on connect |
| 0x07 / 0x08 | Get / SetSysInfo (attribute LTVs) | no |
| 0x09 | UpdateSysInfo (device push of attributes) | handled on receive |
| 0x0B | NotifyCommunicationWay | fallback only, payload `00 00` (DO NOT SEND way = 1) |
| 0x0E | Function (playback etc.) | no |
| 0xC0 | SetADVInfo (LTV) | **yes**: rename, time |
| 0xC1 | GetADVInfo (u32 BE mask) | **yes**: battery and name |
| 0xC2 | NotifyADVInfo (device push) | handled on receive |
| 0xC4 | RequestAdvOp (device push) | handled on receive |
| 0xC5 | ADVSysOp | DANGEROUS (reset / clear pairing) |
| 0xE7 | Reboot | DANGEROUS |
| 0xFF | Custom command (QCY TLV carrier) | **yes**: ANC and EQ |

---

## 5. Session setup

### 5.1 Sequence

1. BLE connect, service discovery, MTU request.
2. Enable notifications on `00000002`.
3. **GetTargetInfo**, mask `0xFFFFFFFF`, platform 0 (OBSERVED):
   `FE DC BA C0 03 00 06 ss FF FF FF FF 00 EF`
   If the device answers status 3 (busy), retry up to 3 times, 500 ms apart (UNVERIFIED: never seen busy).
4. **Time sync**: `SetADV` type 7 with Unix seconds as u32 BE (OBSERVED: status 0, payload `00`):
   `FE DC BA C0 C0 00 07 ss 05 07 T3 T2 T1 T0 EF`
5. Then read battery, name, ANC and EQ (§6), and poll every 3 s.

### 5.2 Authentication and 0x0B

- **Auth:** none (OBSERVED). Jieli auth packets are raw, non-`FEDCBA` frames (17 bytes starting with `00`/`01`, or `02 70 61 73 73` = "pass"). If the device ever sends one, stop: this firmware is not expected to ask for auth.
- **0x0B NotifyCommunicationWay:** not needed (OBSERVED). Two hobby projects send `FE DC BA C0 0B 00 03 ss 00 00 EF` (way = 0 BLE, reconnect = 0) before anything else. This app keeps that frame only as a fallback for when GetTargetInfo gets no answer. **Never send way = 01.**

---

## 6. Commands

The QCY TLV inside opcode 0xFF has this shape:

| Use | Payload |
|---|---|
| Set | `<cmdId> <len> <data[len]>` |
| Get | `FE 01 <cmdId>` |

- A Get response is a 0xFF **response** whose payload is the TLV `<cmdId> <len> <data>` (OBSERVED).
- Device pushes arrive as a 0xFF **command** with the same TLV (OBSERVED for ANC).
- Accept a TLV only if `payload.length == payload[1] + 2`.

### 6.1 ANC / noise control

**Set** (OBSERVED and CAPTURED):

```
FE DC BA C0 FF 00 06 ss 17 03 MM SS LL EF
RX: FE DC BA 00 FF 00 02 00 ss EF        (status 0, empty payload)
```

- `MM` is the mode: 1 = noise cancelling, 2 = off ("Normal"), 3 = transparency.
- `SS` is the scene.
- `LL` is the level.

| UI label | TLV payload | Status |
|---|---|---|
| Normal (ANC off) | `17 03 02 00 00` | CAPTURED |
| Transparency | `17 03 03 01 04` | OBSERVED (confirmed by ear) |
| Noise canceling → Adaptive | `17 03 01 05 00` | CAPTURED |
| Noisy (low / med / high) | `17 03 01 01 00/01/02` | CAPTURED; high OBSERVED |
| Commuting (low / med / high) | `17 03 01 02 00/01/02` | CAPTURED |
| Indoor (low / med / high) | `17 03 01 03 00/01/02` | CAPTURED |
| Anti-wind noise | `17 03 01 04 00` | CAPTURED |
| Default when "Noise canceling" is chosen | `17 03 01 01 02` (Noisy, high) | OBSERVED as the headset's state |

The level mapping 0/1/2 = low/medium/high comes from the H3 Pro capture labels.

**Read the current mode** (OBSERVED):

```
TX: FE DC BA C0 FF 00 04 ss FE 01 17 EF
RX: FE DC BA 00 FF 00 07 00 ss 17 03 MM SS LL EF
```

**Polling.** Read battery (§6.4) and ANC every **3000 ms** while the app is running. The physical-button push (below) is OBSERVED, but polling also catches any change a push misses.

**Physical ANC button.** The headset pushes an unsolicited 0xFF **command** carrying `17 03 MM SS LL` (OBSERVED payload). Ignore pushes for 1000 ms after this app's own ANC write, so a push already in flight does not undo the user's choice.

### 6.2 EQ

#### 6.2.1 TLV choice

- Firmware ≥ 0.9.0.0 uses TLV **0x22** (7-byte bands). OBSERVED on 0.9.1.2, which ignores `FE 01 20` entirely (no reply).
- Older firmware may use TLV **0x20** (6-byte bands, no filter type). UNVERIFIED; this app picks 0x20 only for firmware below 0.9.0.0.
- When the firmware version is unknown, use 0x22, the only format confirmed on hardware.

#### 6.2.2 TLV 0x22 write format (OBSERVED; matches all six H3 Pro captures)

```
FE DC BA C0 FF 00 4C ss | 22 49 | IDX | MG_lo MG_hi | 10 × band | EF        (84 bytes total)
band = F_lo F_hi | G_lo G_hi | Q_lo Q_hi | T
```

| Field | Encoding |
|---|---|
| `0x49` | `= bands × 7 + 3` |
| IDX | preset id 1..6 (Default, Pop, Heavy Bass, Rock, Soft, Classic). Custom = **0x80**, or **0xFF** on the first custom write (UNVERIFIED) |
| MG | master gain: `(int)(dB × 100)` as s16 **LE** |
| F | centre frequency in Hz, u16 **LE** |
| G | gain: `round(dB × 100)` as s16 **LE** |
| Q | `round(Q × 100)` as u16 LE |
| T | filter type u8. 2 = peaking for every H3 band. The other Jieli values (0 = high-pass, 1 = low-pass, 3 = high-shelf, 4 = low-shelf) are UNVERIFIED |

- Always send exactly 10 bands.
- TLV 0x20 is the same layout without `T`: 6-byte bands, `len = n × 6 + 3`.
- **Gain range:** clamp custom sliders to ±8 dB. Presets go down to −12 dB.
- **Custom EQ master gain:** `MG = −5.5 dB − max(0, highest band gain in dB)`, to leave headroom.
- **Custom band set:** 55, 220, 500, 1000, 1800, 2800, 4500, 7500, 10000, 22000 Hz with Q 0.4, 1.2, 1.5, 1.5, 1.2, 0.8, 1.2, 1.2, 1.2, 1.2 and filter type 2.

#### 6.2.3 Preset curves

The six H3 preset curves live in `src/shared/eq-presets.ts`. Each preset has 7 or 8 bands, which the encoder pads to 10 (§10). The Default curve matches the one the headset returned on the first read (OBSERVED: index 1, master −5.5 dB).

The "preset offsets" in some hobby projects are their own approximations, not these curves.

#### 6.2.4 Reading the current EQ (OBSERVED)

- Send `FE 01 22`.
- The response is `22 49 | idx u8 | MG s16 LE /100 | n × (F u16 LE, G s16 LE /100, Q u16 LE /100, T u8)`: the same layout as a write.

### 6.3 Rename (ADV type 1)

```
FE DC BA C0 C0 LL LL ss (N+1) 01 <N bytes name> EF        paramLen = N + 3
RX: FE DC BA 00 C0 00 03 00 ss RR EF                       RR = result
```

| Item | Detail | Status |
|---|---|---|
| Encoding | UTF-8, **no NUL terminator**. Trim leading/trailing whitespace | PUBLIC |
| Max length | 31 bytes (the device field is 32 bytes, NUL-terminated) | PUBLIC (Jieli conventions) |
| Result codes | 0 = OK, 1 = rejected while in game mode, 2 = name too long, 3 = LED settings failed | PUBLIC (Jieli conventions) |
| Empty name | Do not send | — |
| Read back | `C1 00000002` returns ADV type 1 = the name (UTF-8, cut at the first 0x00) | OBSERVED |

The headset does not reboot after a rename. Windows may show the old classic name until the headset restarts or is re-paired (UNVERIFIED).

### 6.4 Battery

- **Advertisement:** see §2 (byte 5 = headset %, bit7 = charging).
- **RCSP** (OBSERVED):

```
FE DC BA C0 C1 00 05 ss 00 00 0D 21 EF
```

- Mask bit *n* requests ADV type *n*. 0x0D21 = types 0 (battery), 5 (work mode), 8 (in-ear), 10 (sleep), 11 (noise mode).
- The response payload after `status sn` is a sequence of LTVs: `len(=1 + value length) | type | value`.

| ADV type | Value |
|---|---|
| 0 battery | bit7 = charging, bits0-6 = %. The H3 returns a **single value** (OBSERVED: `32 00 00` = 50 %) |
| 5 work mode | 2 = game mode, 1 = normal |
| 8 in-ear | — |
| 10 sleep | 1 = on |
| 11 noise mode | Jieli native ANC report. Do not use it to set ANC on the H3 |
| 12 balance | 0..100 |

- The device can also push **0xC2 NotifyADVInfo**. Its fixed 18-byte payload is `vid BE16, uid BE16, pid BE16, chip/ver u8, EDR addr[6], action u8, L, R, Case (bit7 charging), seq u8` (PUBLIC).

### 6.5 Volume and balance

- Do not set volume over RCSP. A2DP/AVRCP already syncs it. On Windows, use the audio endpoint volume.
- **Channel balance** uses ADV type 12, value 0..100 (UNVERIFIED):
  `FE DC BA C0 C0 00 04 ss 02 0C BB EF`
  Read it with `C1` mask `00 00 10 00`.

### 6.6 Game mode (CAPTURED)

```
on:  FE DC BA C0 C0 00 04 ss 02 05 02 EF
off: FE DC BA C0 C0 00 04 ss 02 05 01 EF
```

Read with mask `00 00 00 20`; work mode 2 = game.

### 6.7 GetTargetInfo fields

The response payload after `status sn` is a sequence of LTVs: `len(includes type) | type | value`.

| Type | Field | Encoding |
|---|---|---|
| 0 | protocol version | nibbles → `V_a.b` |
| 1 | battery %, volume, maxVol, flags | bit0 = volume sync |
| 2 | EDR address[6] + profile + status | |
| 3 | platform u8 + license string | |
| 4 | functionMask u32 BE + current function | |
| **5** | **firmware version** | u16 BE, four nibbles → `a.b.c.d` (OBSERVED: `09 12` = 0.9.1.2) |
| 6 | sdkType | |
| 7 | uboot version | |
| 8 | double-backup, needBootLoader, single-backup OTA way | |
| 9 | mandatory-upgrade flag + request-OTA flag | |
| **10** | **vendor id, product id** | u16 BE each (OBSERVED: `1C 52 41 73`; four bytes, no user id) |
| 11 | auth key string | |
| 12 | project code string | |
| 13 | send/receive MTU | u16 BE each |
| 16 | device name | |
| 17 | BLE-only flag + BLE address | |
| 19 | bit0 = MD5 support, bit1 = game mode | |

Only types 5 and 10 are OBSERVED. The rest follow Jieli conventions (PUBLIC).

### 6.8 Device-pushed messages to handle

| Opcode | Meaning | Handling |
|---|---|---|
| 0xFF command | QCY TLV, e.g. `17 03 m s l` ANC change (OBSERVED), `22 …` EQ | Same dispatcher as read responses |
| 0xC2 | NotifyADVInfo: battery and identity (§6.4) | Battery update |
| 0xC4 RequestAdvOp, op 0 | Settings changed | Re-read battery and name |
| 0xC4 RequestAdvOp, op 1 | Needs reboot | Ignore |
| 0xC4 RequestAdvOp, op 2 | Wants time sync | Send the type-7 time write |
| 0x09 UpdateSysInfo | Attribute 1 = volume, 4 = EQ, 6 = mode | Ignore |

None of these get a reply (§4.2).

---

## 7. Mapping table: UI action → bytes (H3, 16755)

Every frame is `FE DC BA <flag> <op> <len BE> <sn> … EF`. Host commands use flag `C0`.

| UI action | Opcode | Payload after sn | Status |
|---|---|---|---|
| ANC → Normal (off) | FF | `17 03 02 00 00` | CAPTURED |
| ANC → Transparency | FF | `17 03 03 01 04` | OBSERVED |
| ANC → Noise canceling (default) | FF | `17 03 01 01 02` | OBSERVED |
| ANC → Adaptive | FF | `17 03 01 05 00` | CAPTURED |
| ANC → Noisy low / med / high | FF | `17 03 01 01 00/01/02` | CAPTURED |
| ANC → Commuting low / med / high | FF | `17 03 01 02 00/01/02` | CAPTURED |
| ANC → Indoor low / med / high | FF | `17 03 01 03 00/01/02` | CAPTURED |
| ANC → Anti-wind noise | FF | `17 03 01 04 00` | CAPTURED |
| Read ANC | FF | `FE 01 17` | OBSERVED |
| EQ preset Default / Pop / Heavy Bass / Rock / Soft / Classic | FF | `22 49 <01..06> <MG LE> <10 × 7-byte bands>` | OBSERVED format |
| Custom EQ (sliders) | FF | `22 49 80 <MG LE> <10 bands at 55/220/500/1000/1800/2800/4500/7500/10000/22000 Hz>` | Format OBSERVED; index UNVERIFIED |
| Read EQ | FF | `FE 01 22` | OBSERVED |
| Rename | C0 | `<N+1> 01 <UTF-8 name>` | PUBLIC |
| Battery | C1 | `00 00 0D 21` | OBSERVED |
| Name | C1 | `00 00 00 02` | OBSERVED |
| Volume | — | not sent; use the OS volume | — |
| Balance (0..100) | C0 | `02 0C <v>` | UNVERIFIED |
| Game mode on / off | C0 | `02 05 02` / `02 05 01` | CAPTURED |
| Firmware version / model | 03 | `FF FF FF FF 00` → types 5 and 10 | OBSERVED |

---

## 8. DO-NOT-SEND list (destructive or state-changing)

`ss` is any sn. These frames follow Jieli RCSP conventions. None was ever sent on purpose. Never send them from a control UI.

| Bytes | Effect |
|---|---|
| `FE DC BA C0 C5 00 02 ss 01 EF` | ADVSysOp **restore settings**: keys and EQ return to defaults |
| `FE DC BA C0 C5 00 02 ss 02 EF` | ADVSysOp **clear paired records**: the headset disconnects |
| `FE DC BA C0 C5 00 02 ss 03 EF` | ADVSysOp **reset** |
| `FE DC BA C0 FF 00 03 ss 03 00 EF` | QCY TLV **factory reset** |
| `FE DC BA C0 FF 00 03 ss 02 00 EF` / `… 01 00 EF` | QCY TLV clear pairing / restore |
| `FE DC BA C0 E7 00 02 ss 00 EF` / `… 01 EF` | **Reboot** / **power off** |
| `FE DC BA C0 0B 00 02 ss 01 EF` | Switch communication to **SPP** (firmware-update prep) |
| Opcodes `E1 E2 E3 E4 E5 E6 E8` | **Firmware update**: query offset, can-update, enter/exit update mode, send block, refresh status, notify size |
| Opcode `06` | Disconnect classic BT (audio drops) |
| `C0` type 2 (keys) or type 3 (LEDs) with untested values | Persistently rewrites button or LED mapping |
| QCY TLVs `0D` (test mode), `52` (sensor test), `3D` (tone play), `14` (auto-off), any unknown cmdId | Undefined, test or persistent behaviour |
| Any frame on the **classic SPP** channel | Out of scope |

---

## 9. Open questions

1. **Flag byte of the physical-button push.** Only the payload was recorded; the fake headset uses `C0`. The probe now records `rawHex` for every push: press the button during a probe run to capture it.
2. **Writes split across ATT packets**: whether the firmware reassembles them.
3. **Rename limits**: the exact firmware limit (31 vs 32 bytes), and when Windows sees the new classic name.
4. **16755 vs 16760**: firmware differences are unknown.
5. **Firmware EQ gain limits** are unknown. Clamp the UI to ±8 dB.
6. **Filter-type values** other than 2 are unverified.
7. **TLV 0x20 on firmware < 0.9** was never seen on hardware.

### Known hobby-project errors (do not copy them)

- **Band field labels.** Some projects label the 7-byte band as `freq, delta_db, ref_gain, Q`. The layout is `freq, gain×100, Q×100, filterType` (OBSERVED by write/read-back). What they call "70 FE" is a master gain of −4.00 dB.
- **Swapped ANC constant names.** One project names `17 03 02 00 00` "transparency" and `17 03 03 01 04` "normal". The first is **off**, the second is **transparency** (OBSERVED by ear).
- **Custom EQ index.** Hobby projects use index `0x00`. This app uses `0x80` (or `0xFF` the first time).

---

## 10. Observed on the owner's H3 (2026-10-19)

Hardware probe on the owner's H3: BLE name `QCY H3-APP`, firmware **0.9.1.2**, vendor id 7250 (0x1C52), product id 16755 (0x4173). Raw captures: `src/main/transport/fixtures/h3-probe-a.json` (stage A), `h3-probe-b.json` (stage B) and `h3-probe-eq.json` (EQ stage). The fake headset replays them byte for byte (`fake-h3.test.ts`). Every response arrived in 20 to 120 ms, with no disconnects, and A2DP music kept playing.

### Confirmed

- **GetTargetInfo answered on the first try.** `0B 00 00` is **not needed**. `h3-model` records this as `COMMUNICATION_WAY_NOTICE_REQUIRED = false`. The `notifyCommunicationWayBle` builder stays only as the no-answer fallback.
- GetTargetInfo carries firmware as type 5 (`09 12` = 0.9.1.2) and ids as type 10 (`1C 52 41 73` = vendor, product).
- SyncTime (`C0`, type 7) returns status 0 with payload `00`.
- Battery `C1 00000D21` answers LTVs in the order type 10 = `02`, type 5 = `01`, type 0 = `32 00 00`. Battery is a **single value** in type 0 (here 50 %), not a per-bud triple.
- Name `C1 00000002` returns type 1 = `QCY H3`.
- ANC read `FE 01 17` returns `17 03 01 01 02` (noise cancelling, noisy, high). SetAnc (Transparency `17 03 03 01 04`, restore `17 03 01 01 02`) returns status 0 with an **empty** payload. The owner confirmed by ear that Transparency engaged.
- **Physical ANC button** pushes opcode `0xFF` with payload `17 03 01 01 02`: the same TLV a read returns.
- **EQ uses TLV 0x22.** `FE 01 22` returns `22 49 01 DA FD ...`: index 1 (Default), master −5.5 dB, **10 bands** in device order 55, 220, 500, 1000, 1800, 2800, 7500, 4500, 10378, 21600 Hz. The filler bands sit at 0 dB with Q 0.7.

### Refuted

- "0x20 on this firmware": the H3 on 0.9.1.2 **ignores `FE 01 20` entirely** (timeout, no reply). It answers `FE 01 22`.
- "Battery is per bud": the H3 returns one headset value in ADV type 0.

### EQ write confirmed

`--stage eq` on hardware (`h3-probe-eq.json`): ReadEq returned the captured index-1 TLV; RewriteCurrentEq (`22 49`, padded Default, 10 bands) returned status 0 with an empty payload in 60 ms; the second ReadEq equalled the written TLV byte for byte. The 0x22 write is proven.

### 10-band rule

Always send exactly 10 EQ bands (§6.2.2). Presets keep their own bands in order, then pad with the custom-band frequencies they lack, in that order, at 0 dB, Q 0.7, filter type 2 (Default gets 1000, 10000, 22000 Hz). The encoder throws for any other band count in both formats. The H3 stores the bands exactly as sent: the read-back after a write is byte-identical to the written TLV (fixture `h3-probe-eq.json`). Compare a read-back byte for byte with the last write. Fillers in an EQ last written by another app (such as 10378 and 21600 Hz in the first read) may differ from ours, because they come from that app's write, not from device quantization or reordering.

### `rawHex` limitation

`rawHex` is the notification chunk that carried a push, not the re-encoded frame. A chunk holding several frames, or a frame split over chunks, gives imprecise raw bytes.
