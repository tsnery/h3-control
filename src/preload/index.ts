// Must stay the first import: zod probes new Function when schemas are built, so jitless has to be set before any module creates one.
import '../shared/zod-jitless'
import { contextBridge, ipcRenderer } from 'electron'
import { createQcyBridge } from './create-qcy-bridge'

contextBridge.exposeInMainWorld('qcy', createQcyBridge(ipcRenderer))
