import { resolveTranscriptionRoute, type TranscriptionRoute } from "../helpers/transcriptionRoute";
import { isManagedTranscriptionActive } from "./managedTranscription";
import i18n from "../i18n";
import type { LocalTranscriptionProvider } from "../types/electron";

export interface FileTranscriptionResult {
  success: boolean;
  text?: string;
  error?: string;
  code?: string;
  messageKey?: string;
  diarized?: boolean;
  // The transcript succeeded, but requested speaker labels could not be applied.
  diarizationWarning?: boolean;
  warning?: string;
  // Set alongside `warning` by the chunked cloud path: how much audio was lost.
  failedChunks?: number;
  totalChunks?: number;
  // Measured duration of the source audio, for persisting as
  // audio_duration_seconds. Only transcribeFileWithSpeakers sets it.
  durationSeconds?: number | null;
  // Segment-level timing from BYOK providers that support it (opts.timestamps
  // or BYOK diarization), with local diarization's speakers when that ran, or
  // the merged speaker turns when the provider returned text only.
  segments?: Array<{ text: string; start: number; end: number; speaker?: string }>;
}

export interface DiarizationSettings {
  enabled: boolean;
  // Local sherpa-onnx models present; BYOK-native diarization doesn't need them.
  localModelsReady: boolean;
  numSpeakers: number | null;
}

export interface FileTranscriptionConfig {
  useLocalWhisper: boolean;
  localTranscriptionProvider: string;
  whisperModel: string;
  parakeetModel: string;
  cohereModel: string;
  isOpenWhisprCloud: boolean;
  getApiKey: () => string;
  cloudTranscriptionProvider: string;
  cloudTranscriptionBaseUrl: string;
  cloudTranscriptionModel: string;
  language: string;
  cortiEnvironment?: string;
  cortiTenant?: string;
  transcriptionMode?: string;
  remoteTranscriptionUrl?: string;
  remoteTranscriptionModel?: string;
}

export interface TranscriptionApiKeys {
  openaiApiKey: string;
  groqApiKey: string;
  xaiApiKey: string;
  mistralApiKey: string;
  geminiApiKey: string;
  tinfoilApiKey: string;
  deepgramApiKey: string;
  assemblyaiApiKey: string;
  openrouterApiKey: string;
  customTranscriptionApiKey?: string;
}

export function getTranscriptionApiKey(provider: string, keys: TranscriptionApiKeys): string {
  switch (provider) {
    case "openai":
      return keys.openaiApiKey;
    case "groq":
      return keys.groqApiKey;
    case "xai":
      return keys.xaiApiKey;
    case "mistral":
      return keys.mistralApiKey;
    case "gemini":
      return keys.geminiApiKey;
    case "tinfoil":
      return keys.tinfoilApiKey;
    case "deepgram":
      return keys.deepgramApiKey;
    case "assemblyai":
      return keys.assemblyaiApiKey;
    case "openrouter":
      return keys.openrouterApiKey;
    case "custom":
      return keys.customTranscriptionApiKey || "";
    default:
      return "";
  }
}

// Shared by the upload and assistant recorder. Only explicit self-hosted
// settings reach the common resolver, so a stale Custom URL cannot take over.
export function resolveFileTranscriptionRoute(cfg: FileTranscriptionConfig): TranscriptionRoute {
  if (cfg.useLocalWhisper && (!cfg.transcriptionMode || cfg.transcriptionMode === "local")) {
    return { transport: "local" };
  }
  if (cfg.transcriptionMode !== "self-hosted") {
    return {
      transport: "error",
      message: i18n.t("common.policyTranscriptionRestricted"),
      code: "LOCAL_ONLY",
    };
  }
  if (!cfg.remoteTranscriptionUrl?.trim()) {
    return {
      transport: "error",
      message: i18n.t("notes.actions.errors.noEndpoint"),
      code: "LOCAL_ONLY",
    };
  }
  return resolveTranscriptionRoute({
    settings: {
      transcriptionMode: "self-hosted",
      remoteTranscriptionUrl: cfg.remoteTranscriptionUrl,
      remoteTranscriptionModel: cfg.remoteTranscriptionModel,
    },
    request: { effectiveLanguage: cfg.language || undefined },
  });
}

// Single dispatch for both the single-file flow and the batch queue.
export async function transcribeFile(
  filePath: string,
  cfg: FileTranscriptionConfig,
  diarize: boolean,
  opts: {
    requestId?: string;
    signal?: AbortSignal;
    timestamps?: boolean;
    purpose?: "dictation" | "upload";
    durationSeconds?: number;
  } = {}
): Promise<FileTranscriptionResult> {
  opts.signal?.throwIfAborted();
  const route = resolveFileTranscriptionRoute(cfg);
  if (route.transport === "local") {
    const provider = cfg.localTranscriptionProvider as LocalTranscriptionProvider;
    return window.electronAPI.transcribeAudioFile(filePath, {
      provider,
      model:
        provider === "nvidia"
          ? cfg.parakeetModel
          : provider === "cohere"
            ? cfg.cohereModel
            : cfg.whisperModel,
      // Only Cohere consumes it (no auto-detect); passing it to whisper would
      // override its auto language detection.
      ...(provider === "cohere" && cfg.language ? { language: cfg.language } : {}),
      requestId: opts.requestId,
      purpose: opts.purpose,
    });
  }

  if (route.transport === "error") {
    return {
      success: false,
      error: route.message,
      code: route.code,
      messageKey: route.messageKey,
    };
  }
  if (route.transport !== "http-batch" || route.provider !== "self-hosted") {
    return {
      success: false,
      error: i18n.t("notes.actions.errors.noEndpoint"),
      code: "LOCAL_ONLY",
    };
  }
  // Main reads the saved self-hosted token. No provider key from a legacy
  // configuration can be forwarded to this endpoint.
  return window.electronAPI.transcribeAudioFileByok!({
    filePath,
    requestId: opts.requestId,
    purpose: opts.purpose,
    diarize: diarize || undefined,
    timestamps: opts.timestamps || undefined,
    language: cfg.language,
    transcriptionMode: "self-hosted",
    remoteTranscriptionUrl: cfg.remoteTranscriptionUrl,
    remoteTranscriptionModel: cfg.remoteTranscriptionModel,
  });
}

// OpenAI/Mistral BYOK handle diarization inside the transcription call itself.
// Self-hosted mode routes to the user's own server, which doesn't — those users
// get local diarization like everyone else.
export function shouldUseByokDiarize(
  cfg: FileTranscriptionConfig,
  diarizationEnabled: boolean
): boolean {
  if (isManagedTranscriptionActive()) return false;
  return (
    diarizationEnabled &&
    !cfg.useLocalWhisper &&
    !cfg.isOpenWhisprCloud &&
    cfg.transcriptionMode !== "self-hosted" &&
    (cfg.cloudTranscriptionProvider === "openai" || cfg.cloudTranscriptionProvider === "mistral")
  );
}

interface DiarizationSettingsRequest {
  enabled: boolean;
  modelsReady: boolean;
  numSpeakers: number | null;
  config: FileTranscriptionConfig;
  ensureModels: () => Promise<boolean>;
}

// Speaker detection is opt-in but its local models download lazily, so a run
// started before they land would report "couldn't be applied" without the
// diarizer ever being invoked. Fetch them first; only the routes that diarize
// server-side can skip the download.
export async function resolveDiarizationSettings({
  enabled,
  modelsReady,
  numSpeakers,
  config,
  ensureModels,
}: DiarizationSettingsRequest): Promise<DiarizationSettings> {
  const needsLocalModels = enabled && !modelsReady && !shouldUseByokDiarize(config, enabled);
  return {
    enabled,
    localModelsReady: needsLocalModels ? await ensureModels() : modelsReady,
    numSpeakers,
  };
}

type SpeakerSpan = { start: number; end: number; speaker: string };

function assignSpeakers(
  segments: NonNullable<FileTranscriptionResult["segments"]>,
  speakerSpans: SpeakerSpan[]
): NonNullable<FileTranscriptionResult["segments"]> {
  return segments.map((segment) => {
    let best = speakerSpans[0];
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const span of speakerSpans) {
      // Positive: seconds of overlap. Negative: the gap to a span that doesn't overlap.
      const score = Math.min(segment.end, span.end) - Math.max(segment.start, span.start);
      if (score > bestScore) {
        best = span;
        bestScore = score;
      }
    }
    return { ...segment, speaker: best.speaker };
  });
}

// Transcribe and diarize in parallel, then merge speaker labels into the text.
// Shared by the single-file flow and the batch queue. `durationSeconds` (when the
// source knows it, e.g. URL downloads) beats inferring duration from segments.
export async function transcribeFileWithSpeakers(
  filePath: string,
  cfg: FileTranscriptionConfig,
  diarization: DiarizationSettings,
  durationSeconds?: number | null,
  opts: { requestId?: string; timestamps?: boolean; isCancelled?: () => boolean } = {}
): Promise<FileTranscriptionResult> {
  if (opts.isCancelled?.()) return { success: false, code: "AUDIO_OPERATION_CANCELLED" };
  const byokDiarize = shouldUseByokDiarize(cfg, diarization.enabled);
  const diarizePromise =
    diarization.enabled && diarization.localModelsReady && !byokDiarize
      ? (window.electronAPI
          .diarizeAudioFile?.(filePath, {
            numSpeakers: diarization.numSpeakers ?? undefined,
            requestId: opts.requestId,
          })
          .catch(() => null) ?? Promise.resolve(null))
      : Promise.resolve(null);

  const [transcribed, diar] = await Promise.all([
    transcribeFile(filePath, cfg, byokDiarize, opts),
    diarizePromise,
  ]);
  if (opts.isCancelled?.()) return { success: false, code: "AUDIO_OPERATION_CANCELLED" };

  // The diarizer measures the converted audio, so it covers picked files whose
  // duration the caller never knew. 0/NaN mean "unknown", hence ||.
  const measuredDuration = durationSeconds || (diar?.success && diar.durationSeconds) || null;
  const result = { ...transcribed, durationSeconds: measuredDuration };

  if (!result.success || !result.text || !diarization.enabled || result.diarized) return result;
  if (!diar?.success || !diar.segments?.length) {
    return { ...result, diarizationWarning: true };
  }

  try {
    const merged = await window.electronAPI.mergeSpeakerText?.(
      diar.segments,
      result.text,
      measuredDuration || 0
    );
    if (merged?.success && merged.text) {
      // The transcript keeps who spoke when: the provider's timed segments get
      // the speaker they overlap most, and without them the merged turns
      // (placed by their share of the text) stand in.
      return {
        ...result,
        text: merged.text,
        segments: result.segments
          ? assignSpeakers(result.segments, diar.segments)
          : merged.segments,
      };
    }
  } catch {
    // Merge failure falls back to the plain transcript.
  }
  return { ...result, diarizationWarning: true };
}
