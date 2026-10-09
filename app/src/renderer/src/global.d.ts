import type { NononBridge } from "../../shared/ipc";

declare global {
  interface Window {
    nonon: NononBridge;
  }
}
export {};
