import { join } from "node:path";

/**
 * Everything NONON is allowed to download, pinned. URLs, sizes and SHA-256 values are the ones
 * Pragma verified (llama.cpp b10909, unsloth Qwen3.5 GGUF at fixed revisions). Nothing else is
 * ever fetched, and nothing is fetched until the person presses install.
 */

export const ALLOWED_PREFIXES = [
  "https://github.com/ggml-org/llama.cpp/releases/download/",
  "https://huggingface.co/unsloth/",
];

/** Tokens the server is started with. Pragma runs 128K for agent engines; NONON's tasks are short, so memory stays small. */
export const CONTEXT_TOKENS = 16384;
export const SPARE_DISK_BYTES = 1_000_000_000;
export const LLAMA_CPP_LICENCE = "MIT";

export interface Pin {
  url: string;
  bytes: number;
  sha256: string;
}

export type RuntimeId = "vulkan" | "cuda" | "metal";

export interface RuntimePin extends Pin {
  id: RuntimeId;
  /** Folder under modelDir/runtime that the archive is unpacked into. */
  folder: string;
  /** Server path inside that folder. */
  exe: string;
  /** Second archive unpacked beside the first (CUDA libraries). */
  extra?: Pin;
}

export const RUNTIME_VULKAN: RuntimePin = {
  id: "vulkan",
  folder: "b10909",
  exe: "llama-server.exe",
  url: "https://github.com/ggml-org/llama.cpp/releases/download/b10909/llama-b10909-bin-win-vulkan-x64.zip",
  bytes: 31_667_126,
  sha256: "96b2efab6e6b0498d5d4809a30b7981868be8a1ada9cd76b92f3b1f1fdba4772",
};

export const RUNTIME_CUDA: RuntimePin = {
  id: "cuda",
  folder: "b10909-cuda13.3",
  exe: "llama-server.exe",
  url: "https://github.com/ggml-org/llama.cpp/releases/download/b10909/llama-b10909-bin-win-cuda-13.3-x64.zip",
  bytes: 149_698_617,
  sha256: "257fef963d0fb5d5f9786760b127bf92ddffc14034befe9c42282be97852cb8b",
  extra: {
    url: "https://github.com/ggml-org/llama.cpp/releases/download/b10909/cudart-llama-bin-win-cuda-13.3-x64.zip",
    bytes: 390_970_417,
    sha256: "1462a050eb4c684921ba51dcc4cc488a036674c3e73e9945ee705b854808d03e",
  },
};

export const CUDA_DRIVER_NEEDED = { major: 13, minor: 3 };

export const RUNTIME_METAL: RuntimePin = {
  id: "metal",
  folder: "b10909-macos-arm64",
  exe: join("llama-b10909", "llama-server"),
  url: "https://github.com/ggml-org/llama.cpp/releases/download/b10909/llama-b10909-bin-macos-arm64.tar.gz",
  bytes: 11_145_825,
  sha256: "ce8839bb6b7f5ead5d391df48f5e2a0e139fe9c2ce9fcb9c3d41dbf73016aa36",
};

export interface LocalModel extends Pin {
  id: string;
  label: string;
  file: string;
  licence: string;
  mode: "limited" | "recommended";
  /** Rough memory the weights plus a 16K window need while running. An estimate until measured; see runtime-evidence.md. */
  memoryBytes: number;
}

export const MODELS: LocalModel[] = [
  {
    id: "qwen3.5-4b",
    label: "Qwen3.5 4B",
    file: "Qwen3.5-4B-Q4_K_M.gguf",
    url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/e87f176479d0855a907a41277aca2f8ee7a09523/Qwen3.5-4B-Q4_K_M.gguf",
    bytes: 2_740_937_888,
    sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
    licence: "Apache-2.0",
    mode: "limited",
    memoryBytes: 3_600_000_000,
  },
  {
    id: "qwen3.5-9b",
    label: "Qwen3.5 9B",
    file: "Qwen3.5-9B-Q4_K_M.gguf",
    url: "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/3885219b6810b007914f3a7950a8d1b469d598a5/Qwen3.5-9B-Q4_K_M.gguf",
    bytes: 5_680_522_464,
    sha256: "03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8",
    licence: "Apache-2.0",
    mode: "recommended",
    memoryBytes: 6_800_000_000,
  },
];

export function findModel(id: string): LocalModel | undefined {
  return MODELS.find((m) => m.id === id);
}

export function runtimeCandidates(platform: NodeJS.Platform, arch: string, cudaOk: boolean): RuntimePin[] {
  if (platform === "win32" && arch === "x64") return cudaOk ? [RUNTIME_CUDA, RUNTIME_VULKAN] : [RUNTIME_VULKAN];
  if (platform === "darwin" && arch === "arm64") return [RUNTIME_METAL];
  return [];
}

export function unsupportedReason(platform: NodeJS.Platform, arch: string): string | undefined {
  if (platform === "win32" && arch === "x64") return undefined;
  if (platform === "darwin" && arch === "arm64") return undefined;
  if (platform === "darwin") return "This Mac has an Intel chip. The AI on this computer needs a Mac with Apple silicon (M1 or newer). It would be too slow here.";
  if (platform === "win32") return "The AI on this computer needs a standard 64-bit Windows PC. This one has a different kind of processor.";
  return "The AI on this computer works on Windows PCs and Macs with Apple silicon.";
}
