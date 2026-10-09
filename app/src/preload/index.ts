import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { EventName, NononBridge } from "../shared/ipc";

const bridge: NononBridge = {
  call: (channel, arg) => ipcRenderer.invoke(channel, arg),
  on(event: EventName, cb) {
    const listener = (_e: unknown, payload: unknown) => cb(payload as Parameters<typeof cb>[0]);
    ipcRenderer.on(`evt:${event}`, listener);
    return () => {
      ipcRenderer.removeListener(`evt:${event}`, listener);
    };
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  platform: process.platform,
};

contextBridge.exposeInMainWorld("nonon", bridge);
