import { useRegistryVersion } from "../../hooks/useRegistryVersion";
import { useState, useRef, useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../ui/useToast";
import {
  FileAudio,
  X,
  AlertCircle,
  AlertTriangle,
  FolderOpen,
  Plus,
  Settings,
  Users,
} from "../icons";
import { useShallow } from "zustand/react/shallow";
import { Button } from "../ui/button";
import { PAGE_CONTENT_WIDTH_CLASS } from "../ui/pageWidth";
import { CARD_SURFACE_CLASS } from "../ui/surfaces";
import { GRADIENT_CIRCLE } from "../ui/gradientCircle";
import { Toggle } from "../ui/toggle";
import EmptyStateCard from "../ui/EmptyStateCard";
import { DropZone } from "../ui/DropZone";
import { cn } from "../lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Input } from "../ui/input";
import type { FolderItem } from "../../types/electron";
import {
  findDefaultFolder,
  folderPathLabel,
  orderFoldersAsTree,
  transcriptionErrorKey,
  uploadRestrictionKey,
  MEETINGS_FOLDER_NAME,
  folderMutationErrorDescription,
} from "./shared";
import { describeProviderError } from "../../utils/describeProviderError";
import {
  getAllReasoningModels,
  getParakeetModelInfo,
  isSherpaLocalProvider,
  enterpriseProviderName,
} from "../../models/ModelRegistry";
import {
  useSettingsStore,
  selectIsCloudCleanupMode,
  selectPolicyEffectiveSettings,
  selectResolvedUploadTranscription,
  getSettings,
} from "../../stores/settingsStore";
import { useBatchQueue } from "../../stores/batchQueueStore";
import type { TranscribeOptions } from "../../stores/batchQueueStore";
import {
  transcribeFileWithSpeakers,
  resolveDiarizationSettings,
  shouldUseByokDiarize,
} from "../../services/fileTranscription";
import type {
  FileTranscriptionConfig,
  FileTranscriptionResult,
  DiarizationSettings,
} from "../../services/fileTranscription";
import { MAX_SPEAKER_COUNT } from "../../constants/speakerDetection.json";
import BatchQueueView from "./BatchQueueView";
import { generateNoteTitle } from "../../utils/generateTitle";
import { getBaseLanguageCode } from "../../utils/languageSupport";
import {
  isAudioFeatureAllowed,
  isAudioFeatureDenied,
  isTranscriptionContextAllowed,
  transcriptionChoiceRefusal,
} from "../../stores/policyRules";
import { usePolicyStore } from "../../stores/policyStore";
import { onWorkspaceScopePublished } from "../../stores/workspaceStore";
import {
  usePolicySnapshot,
  useTranscriptionChoiceRefusal,
  useTranscriptionContextAllowed,
} from "../../hooks/usePolicy";
import { saveUploadNote, uploadTitleFallback } from "../../services/uploadNotes";
import { useManagedScopeResolution } from "../../stores/enterpriseIdentityStore";
import { isManagedTranscriptionActive } from "../../services/managedTranscription";
import { UploadCompleteWarnings, UploadModelSettingsButton } from "./UploadAudioFeedback";
import { isSupportedUploadFile } from "../../utils/uploadAudioFormats";

type UploadState = "idle" | "selected" | "transcribing" | "complete" | "error";

// Every action on this page: the brand pill for the next step, a ghost pill beside it.
const PRIMARY_ACTION_CLASS = "rounded-full px-5 font-medium";
const SECONDARY_ACTION_CLASS = "rounded-full px-4";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface UploadAudioViewProps {
  onNoteCreated?: (noteId: number, folderId: number | null) => void;
  onOpenSettings?: (section: string) => void;
}

export default function UploadAudioView({ onNoteCreated, onOpenSettings }: UploadAudioViewProps) {
  useRegistryVersion();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [state, setState] = useState<UploadState>("idle");
  const [file, setFile] = useState<{
    name: string;
    path: string;
    size: string;
    sizeBytes: number;
    durationSeconds?: number | null;
  } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState<{ failed: number; total: number } | null>(
    null
  );
  const [diarizationWarning, setDiarizationWarning] = useState(false);
  const [noteId, setNoteId] = useState<number | null>(null);
  // The saved note's space: from then on the folder picker files that note, so it lists that
  // space's folders, never the Private of a workspace switched to since (M10).
  const noteSpaceIdRef = useRef<number | null>(null);
  const loadFoldersRef = useRef<() => Promise<void>>(async () => {});
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [chunkProgress, setChunkProgress] = useState<{
    chunksTotal: number;
    chunksCompleted: number;
  } | null>(null);
  const progressCleanupRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef(0);
  const activeRequestIdRef = useRef<string | null>(null);
  const [skippedNotice, setSkippedNotice] = useState<string | null>(null);

  const batch = useBatchQueue();

  const [diarizationEnabled, setDiarizationEnabled] = useState(
    () => localStorage.getItem("uploadDiarizationEnabled") === "true"
  );
  // Earlier builds accepted decimals; a saved one would read as Auto.
  const [diarizationNumSpeakers, setDiarizationNumSpeakers] = useState<string>(() => {
    const saved = localStorage.getItem("uploadDiarizationNumSpeakers") || "";
    return /^\d+$/.test(saved) ? saved : "";
  });
  const [diarizationModelsReady, setDiarizationModelsReady] = useState<boolean | null>(null);
  const [diarizationDownloading, setDiarizationDownloading] = useState(false);

  useEffect(() => {
    localStorage.setItem("uploadDiarizationEnabled", String(diarizationEnabled));
  }, [diarizationEnabled]);

  useEffect(() => {
    localStorage.setItem("uploadDiarizationNumSpeakers", diarizationNumSpeakers);
  }, [diarizationNumSpeakers]);

  const diarizationDownloadRef = useRef<Promise<boolean> | null>(null);
  // Callers share one in-flight download: a transcribe started while the
  // mount-time heal is still fetching has to wait for it, not give up and
  // report that speaker detection couldn't be applied.
  const ensureDiarizationModels = (): Promise<boolean> => {
    if (diarizationDownloadRef.current) return diarizationDownloadRef.current;
    setDiarizationDownloading(true);
    const pending = (async () => {
      try {
        await window.electronAPI.downloadDiarizationModels?.();
        const status = await window.electronAPI.getDiarizationModelStatus?.();
        const ready = status?.modelsDownloaded ?? false;
        setDiarizationModelsReady(ready);
        return ready;
      } finally {
        diarizationDownloadRef.current = null;
        setDiarizationDownloading(false);
      }
    })();
    diarizationDownloadRef.current = pending;
    return pending;
  };

  const buildDiarizationSettings = (): Promise<DiarizationSettings> =>
    resolveDiarizationSettings({
      enabled: diarizationEnabled,
      modelsReady: !!diarizationModelsReady,
      numSpeakers: diarizationNumSpeakers ? Number(diarizationNumSpeakers) : null,
      config: buildTranscriptionConfig(),
      ensureModels: ensureDiarizationModels,
    });

  useEffect(() => {
    window.electronAPI.getDiarizationModelStatus?.().then((status) => {
      const ready = status?.modelsDownloaded ?? false;
      setDiarizationModelsReady(ready);
      // Heal a persisted-on toggle whose models were removed since; roll it back
      // if the download fails so it can't sit ON while doing nothing.
      if (!ready && localStorage.getItem("uploadDiarizationEnabled") === "true") {
        if (shouldUseByokDiarize(buildTranscriptionConfig(), true)) return;
        ensureDiarizationModels().then((ok) => {
          if (!ok) setDiarizationEnabled(false);
        });
      }
    });
    // Mount-only by design: heals persisted state against the models on disk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [folders, setFolders] = useState<FolderItem[]>([]);
  // The active workspace's Private, whose folders the list shows and new folders go to.
  const [privateSpaceId, setPrivateSpaceId] = useState<number | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  // Batch destination folder, deliberately separate from the single-flow one:
  // handleFolderChange moves the already-saved note when noteId is set.
  const [batchFolderId, setBatchFolderId] = useState<string>("");
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const [providerReady, setProviderReady] = useState<boolean | null>(null);

  const policyState = usePolicySnapshot();

  const {
    useLocalWhisper,
    whisperModel,
    localTranscriptionProvider,
    parakeetModel,
    cohereModel,
    cloudTranscriptionProvider,
    cloudTranscriptionModel,
    cloudTranscriptionBaseUrl,
    transcriptionMode,
    remoteTranscriptionUrl,
    remoteTranscriptionModel,
  } = useSettingsStore(
    useShallow((settings) =>
      selectResolvedUploadTranscription(selectPolicyEffectiveSettings(settings, policyState))
    )
  );
  const uploadAllowedByPolicy = useTranscriptionContextAllowed("upload");
  const uploadChoiceRefusal = useTranscriptionChoiceRefusal("upload");
  // The org's upload switch, which the banner explains and the inputs follow.
  const uploadFeatureAllowed = isAudioFeatureAllowed(policyState, "upload");
  const uploadRestrictionId = useId();
  const uploadRestrictionDescription = uploadFeatureAllowed ? undefined : uploadRestrictionId;

  const preferredLanguage = useSettingsStore((s) => s.preferredLanguage);
  const isCloudCleanup = useSettingsStore((settings) =>
    selectIsCloudCleanupMode(selectPolicyEffectiveSettings(settings, policyState))
  );
  const effectiveCleanupModel = useSettingsStore((settings) => {
    const effectiveSettings = selectPolicyEffectiveSettings(settings, policyState);
    return selectIsCloudCleanupMode(effectiveSettings) ? "" : effectiveSettings.cleanupModel;
  });
  const useCleanupModel = useSettingsStore((s) => s.useCleanupModel);
  const enterpriseTranscriptionSetupMode = useSettingsStore(
    (s) => s.enterpriseTranscriptionSetupMode
  );
  const managed = useManagedScopeResolution("transcription", enterpriseTranscriptionSetupMode);
  const managedActive = managed.kind === "managed";

  const isSelfHosted = transcriptionMode === "self-hosted" && !useLocalWhisper;

  useEffect(() => {
    return () => {
      if (progressRef.current) clearInterval(progressRef.current);
      progressCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    // Local audio imports file into the private space. Read the folder list again
    // each time main takes a new workspace scope (a switch), keeping a picked
    // folder while that Private still has it. Once a note is saved, the list
    // stays on that note's space.
    let unmounted = false;
    let latestLoad = 0;
    const loadFolders = async () => {
      const load = ++latestLoad;
      try {
        const spaceId =
          noteSpaceIdRef.current ?? (await window.electronAPI.getPrivateSpaceId?.()) ?? null;
        const items = (await window.electronAPI.getFolders?.(spaceId)) ?? [];
        if (unmounted || load !== latestLoad) return;
        setPrivateSpaceId(spaceId);
        setFolders(items);
        const personal = findDefaultFolder(items);
        const keepOrDefault = (current: string): string =>
          items.some((folder) => String(folder.id) === current)
            ? current
            : personal
              ? String(personal.id)
              : "";
        setSelectedFolderId(keepOrDefault);
        setBatchFolderId(keepOrDefault);
      } catch (error) {
        if (!unmounted) console.error("Failed to load upload folders:", error);
      }
    };
    loadFoldersRef.current = loadFolders;
    void loadFolders();
    const stopReloading = onWorkspaceScopePublished(() => void loadFolders());
    return () => {
      unmounted = true;
      stopReloading();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const checkProviderReady = async () => {
      if (managedActive) {
        setProviderReady(true);
        return;
      }
      if (!useLocalWhisper) {
        if (!cancelled) setProviderReady(isSelfHosted && Boolean(remoteTranscriptionUrl?.trim()));
        return;
      }
      const sherpa = isSherpaLocalProvider(localTranscriptionProvider);
      const r = sherpa
        ? await window.electronAPI.listParakeetModels?.()
        : await window.electronAPI.listWhisperModels?.();
      let ready = !!(r?.success && r.models.some((m: { downloaded?: boolean }) => m.downloaded));
      // The lists hold offered models only; a retired model still on disk keeps running.
      const selected = sherpa
        ? localTranscriptionProvider === "cohere"
          ? cohereModel
          : parakeetModel
        : whisperModel;
      if (!ready && selected) {
        const status = sherpa
          ? await window.electronAPI.checkParakeetModelStatus?.(selected)
          : await window.electronAPI.checkModelStatus?.(selected);
        ready = !!status?.downloaded;
      }
      if (!cancelled) setProviderReady(ready);
    };
    checkProviderReady();
    return () => {
      cancelled = true;
    };
  }, [
    managedActive,
    isSelfHosted,
    remoteTranscriptionUrl,
    useLocalWhisper,
    localTranscriptionProvider,
    whisperModel,
    parakeetModel,
    cohereModel,
  ]);

  const getActiveModelLabel = (): string => {
    if (managed.kind === "managed")
      return `${enterpriseProviderName(managed.provider)} · ${managed.model}`;
    if (useLocalWhisper) {
      if (uploadChoiceRefusal) return t("models.policy.chooseModel");
      if (localTranscriptionProvider === "nvidia")
        return getParakeetModelInfo(parakeetModel)?.name ?? parakeetModel;
      if (localTranscriptionProvider === "cohere") return `Cohere · ${cohereModel || "default"}`;
      return `Whisper · ${whisperModel || "base"}`;
    }
    if (isSelfHosted) {
      const name = t("settingsPage.transcription.modes.selfHosted");
      return remoteTranscriptionModel ? `${name} · ${remoteTranscriptionModel}` : name;
    }
    return t("notes.upload.noProviderAction");
  };

  const buildTranscriptionConfig = (): FileTranscriptionConfig => ({
    useLocalWhisper,
    localTranscriptionProvider: localTranscriptionProvider as string,
    whisperModel,
    parakeetModel,
    cohereModel,
    isOpenWhisprCloud: false,
    getApiKey: () => "",
    cloudTranscriptionProvider: cloudTranscriptionProvider as string,
    cloudTranscriptionBaseUrl: cloudTranscriptionBaseUrl || "",
    cloudTranscriptionModel,
    // Empty = auto-detect; the resolver supplies a default where one is required.
    language: getBaseLanguageCode(preferredLanguage) || "",
    transcriptionMode,
    remoteTranscriptionUrl,
    remoteTranscriptionModel,
  });

  const generateTitle = async (text: string): Promise<string> => {
    if (!useCleanupModel) return "";
    if (!getSettings().autoGenerateNoteTitle) return "";
    const model = isCloudCleanup ? "" : effectiveCleanupModel || getAllReasoningModels()[0]?.value;
    if (!model && !isCloudCleanup) return "";
    return generateNoteTitle(text, model);
  };

  const handleBrowse = async () => {
    if (!isAudioFeatureAllowed(usePolicyStore.getState(), "upload")) return;
    const res = await window.electronAPI.selectAudioFile({ multiple: true });
    if (res.canceled) return;

    const filePaths: string[] = res.filePaths || (res.filePath ? [res.filePath] : []);
    if (filePaths.length === 0) return;

    // While a batch runs (or a queue exists), new files join the queue.
    if (filePaths.length === 1 && !batch.isProcessing && !batch.hasQueue) {
      const fp = filePaths[0];
      const name = fp.split(/[/\\]/).pop() || "audio";
      const sizeBytes = (await window.electronAPI.getFileSize?.(fp)) ?? 0;
      setFile({ name, path: fp, size: sizeBytes ? formatFileSize(sizeBytes) : "", sizeBytes });
      setState("selected");
      setError(null);
      return;
    }

    const items: Array<{ name: string; path: string; sizeBytes: number }> = [];
    for (const fp of filePaths) {
      const name = fp.split(/[/\\]/).pop() || "audio";
      const sizeBytes = (await window.electronAPI.getFileSize?.(fp)) ?? 0;
      items.push({ name, path: fp, sizeBytes });
    }
    batch.addFiles(items);
  };

  const handleDroppedFiles = (files: File[]) => {
    if (!isAudioFeatureAllowed(usePolicyStore.getState(), "upload")) return;
    const validFiles: Array<{ name: string; path: string; sizeBytes: number }> = [];
    const skippedNames: string[] = [];
    for (const f of files) {
      if (!isSupportedUploadFile(f.name)) {
        skippedNames.push(f.name);
        continue;
      }
      const filePath = window.electronAPI.getPathForFile(f);
      if (filePath) {
        validFiles.push({ name: f.name, path: filePath, sizeBytes: f.size });
      }
    }

    setSkippedNotice(
      skippedNames.length > 0
        ? t("notes.upload.unsupportedFiles", { names: skippedNames.join(", ") })
        : null
    );
    if (validFiles.length === 0) return;

    if (validFiles.length === 1 && !batch.isProcessing && !batch.hasQueue) {
      const f = validFiles[0];
      setFile({
        name: f.name,
        path: f.path,
        size: formatFileSize(f.sizeBytes),
        sizeBytes: f.sizeBytes,
      });
      setState("selected");
      setError(null);
    } else {
      batch.addFiles(validFiles);
    }
  };

  const reset = () => {
    if (progressRef.current) clearInterval(progressRef.current);
    if (progressCleanupRef.current) progressCleanupRef.current();
    progressCleanupRef.current = null;
    setState("idle");
    setFile(null);
    setResult(null);
    setPartialWarning(null);
    setDiarizationWarning(false);
    setNoteId(null);
    // The next upload files into the active workspace's Private again, which a switch made while
    // the note was open may have changed.
    if (noteSpaceIdRef.current != null) {
      noteSpaceIdRef.current = null;
      void loadFoldersRef.current();
    }
    setError(null);
    setProgress(0);
    setChunkProgress(null);
    setSkippedNotice(null);
    const personal = findDefaultFolder(folders);
    if (personal) setSelectedFolderId(String(personal.id));
  };

  const cancelTranscription = () => {
    // Abort the provider request and discard late results from a cancelled run.
    if (activeRequestIdRef.current) {
      window.electronAPI.cancelUploadTranscription?.(activeRequestIdRef.current);
      activeRequestIdRef.current = null;
    }
    runIdRef.current++;
    reset();
  };
  useEffect(() => {
    return usePolicyStore.subscribe((policy) => {
      if (!isAudioFeatureDenied(policy, "upload")) return;
      const active = activeRequestIdRef.current;
      runIdRef.current++;
      if (active) {
        if (progressRef.current) clearInterval(progressRef.current);
        progressCleanupRef.current?.();
        progressCleanupRef.current = null;
        setState("error");
        setError(t(uploadRestrictionKey(policy)));
      }
      if (activeRequestIdRef.current) {
        window.electronAPI.cancelUploadTranscription?.(activeRequestIdRef.current);
        activeRequestIdRef.current = null;
      }
    });
  }, [t]);

  const handleTranscribe = async () => {
    if (!file || batch.isProcessing) return;
    const policy = usePolicyStore.getState();
    if (!isAudioFeatureAllowed(policy, "upload")) {
      setError(t(uploadRestrictionKey(policy)));
      return;
    }
    if (
      !isManagedTranscriptionActive() &&
      !isTranscriptionContextAllowed(policy, getSettings(), "upload")
    ) {
      const refusal = transcriptionChoiceRefusal(policy, getSettings(), "upload");
      setError(t(refusal?.messageKey ?? "common.managedByOrg"));
      setState("error");
      return;
    }
    const currentFile = file;
    const runId = ++runIdRef.current;
    const requestId = crypto.randomUUID();
    activeRequestIdRef.current = requestId;
    setState("transcribing");
    setError(null);
    setProgress(0);
    setChunkProgress(null);
    setDiarizationWarning(false);

    // Managed and OpenRouter uploads go out in pieces, and a single piece reports
    // nothing until it is done, so the simulated bar covers it.
    const useChunkProgress = managedActive;

    if (useChunkProgress) {
      progressCleanupRef.current =
        window.electronAPI.onUploadTranscriptionProgress?.((data) => {
          if (data.chunksTotal <= 1) return;
          if (progressRef.current) clearInterval(progressRef.current);
          setChunkProgress({
            chunksTotal: data.chunksTotal,
            chunksCompleted: data.chunksCompleted,
          });
          setProgress((prev) => Math.max(prev, (data.chunksCompleted / data.chunksTotal) * 90));
        }) ?? null;
    }
    {
      progressRef.current = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) {
            if (progressRef.current) clearInterval(progressRef.current);
            return prev;
          }
          return prev + Math.random() * 6;
        });
      }, 500);
    }

    try {
      const diarization = await buildDiarizationSettings();
      // A Cancel while speaker models download came before the main process had
      // anything to abort; starting now would send, and bill, the whole upload.
      if (runId !== runIdRef.current) return;
      const res: FileTranscriptionResult = await transcribeFileWithSpeakers(
        currentFile.path,
        buildTranscriptionConfig(),
        diarization,
        currentFile.durationSeconds,
        { requestId, timestamps: true, isCancelled: () => runId !== runIdRef.current }
      );

      if (runId !== runIdRef.current) return;

      if (progressRef.current) clearInterval(progressRef.current);
      if (progressCleanupRef.current) progressCleanupRef.current();
      progressCleanupRef.current = null;

      if (res.success && res.text) {
        setProgress(100);
        setResult(res.text);
        setPartialWarning(
          res.failedChunks && res.totalChunks
            ? { failed: res.failedChunks, total: res.totalChunks }
            : null
        );
        setDiarizationWarning(!!res.diarizationWarning);

        const aiTitle = await generateTitle(res.text);
        if (runId !== runIdRef.current) return;
        const title = aiTitle || uploadTitleFallback(res.text, currentFile.name);

        const noteRes = await saveUploadNote({
          title,
          text: res.text,
          sourceName: currentFile.name,
          folderId: selectedFolderId ? Number(selectedFolderId) : null,
          diarization,
          durationSeconds: res.durationSeconds,
          segments: res.segments,
        });
        if (runId !== runIdRef.current) return;
        if (noteRes.success && noteRes.note) {
          noteSpaceIdRef.current = noteRes.note.space_id ?? null;
          setNoteId(noteRes.note.id);
        }
        setState("complete");
      } else {
        setProgress(0);
        const errorKey = transcriptionErrorKey(res);
        setError(
          errorKey
            ? t(`notes.upload.${errorKey}`)
            : res.messageKey
              ? describeProviderError({ ...res, message: res.error }, t).description
              : res.error || t("notes.upload.transcriptionFailed")
        );
        setState("error");
      }
    } catch (err) {
      if (runId !== runIdRef.current) return;
      if (progressRef.current) clearInterval(progressRef.current);
      if (progressCleanupRef.current) progressCleanupRef.current();
      progressCleanupRef.current = null;
      setProgress(0);
      const errorKey = transcriptionErrorKey(err);
      if (errorKey) {
        setError(t(`notes.upload.${errorKey}`));
      } else {
        setError(
          err instanceof Error
            ? describeProviderError(err, t).description
            : t("notes.upload.errorOccurred")
        );
      }
      setState("error");
    } finally {
      if (activeRequestIdRef.current === requestId) activeRequestIdRef.current = null;
    }
  };

  const handleRetry = () => {
    if (file) void handleTranscribe();
    else reset();
  };

  const startBatchProcessing = async () => {
    if (state === "transcribing") return;
    const policy = usePolicyStore.getState();
    if (!isAudioFeatureAllowed(policy, "upload")) {
      setSkippedNotice(t(uploadRestrictionKey(policy)));
      return;
    }
    if (
      !isManagedTranscriptionActive() &&
      !isTranscriptionContextAllowed(policy, getSettings(), "upload")
    ) {
      const refusal = transcriptionChoiceRefusal(policy, getSettings(), "upload");
      setSkippedNotice(t(refusal?.messageKey ?? "common.managedByOrg"));
      return;
    }
    setSkippedNotice(null);

    const transcribeOpts: TranscribeOptions = {
      transcription: buildTranscriptionConfig(),
      folderId: batchFolderId ? Number(batchFolderId) : null,
      generateTitle: async (text) => (await generateTitle(text)) || null,
    };

    batch.processQueue(transcribeOpts, await buildDiarizationSettings());
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const res = await window.electronAPI.createFolder(trimmed, privateSpaceId);
    if (res.success && res.folder) {
      setFolders((prev) => [...prev, res.folder!]);
      const newId = String(res.folder.id);
      setSelectedFolderId(newId);
      if (noteId != null) {
        window.electronAPI.updateNote(noteId, { folder_id: res.folder.id });
      }
    } else {
      toast({
        title: t("notes.folders.couldNotCreate"),
        description: folderMutationErrorDescription(res, folders, t, {
          name: trimmed,
          nested: false,
        }),
        variant: "destructive",
      });
    }
    setNewFolderName("");
    setShowNewFolderDialog(false);
  };

  const handleFolderChange = (val: string) => {
    if (val === "__create_new__") {
      setShowNewFolderDialog(true);
      return;
    }
    setSelectedFolderId(val);
    if (noteId != null) {
      window.electronAPI.updateNote(noteId, { folder_id: Number(val) });
    }
  };

  const getTranscribingLabel = (): string => {
    if (managed.kind === "managed")
      return t("notes.upload.transcribingProvider", {
        provider: enterpriseProviderName(managed.provider),
      });
    if (useLocalWhisper) return t("notes.upload.transcribingLocal");
    if (isSelfHosted) {
      return t("notes.upload.transcribingProvider", {
        provider: t("settingsPage.transcription.modes.selfHosted"),
      });
    }
    return t("notes.upload.transcribingProvider", { provider: cloudTranscriptionProvider });
  };

  return (
    <div className="flex flex-col items-center h-full overflow-y-auto">
      <div
        className={cn(PAGE_CONTENT_WIDTH_CLASS, "px-6 py-8 shrink-0 my-auto")}
        style={{ animation: "float-up 0.4s ease-out" }}
      >
        {(!uploadFeatureAllowed || (!uploadAllowedByPolicy && uploadChoiceRefusal)) && (
          <p
            id={uploadRestrictionId}
            role="status"
            className="mb-5 flex items-center justify-center gap-2 rounded-lg border border-warning/20 bg-warning/8 px-4 py-3 text-sm text-amber-700 dark:bg-warning/10 dark:text-warning/90"
          >
            <AlertTriangle
              aria-hidden="true"
              className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-warning"
            />
            {t(uploadChoiceRefusal?.messageKey ?? uploadRestrictionKey(policyState))}
          </p>
        )}
        {state === "idle" && providerReady === false && (
          <NoProviderView t={t} onOpenSettings={() => onOpenSettings?.("uploadTranscription")} />
        )}

        {state === "idle" && providerReady !== false && (
          <IdleView
            t={t}
            getActiveModelLabel={getActiveModelLabel}
            handleDroppedFiles={handleDroppedFiles}
            handleBrowse={handleBrowse}
            onOpenSettings={onOpenSettings}
            disabled={!uploadFeatureAllowed}
            describedBy={uploadRestrictionDescription}
          />
        )}

        {skippedNotice && <p className="mt-2 text-center text-xs text-warning">{skippedNotice}</p>}

        {batch.hasQueue && (
          <div className="mt-5">
            <BatchQueueView
              queue={batch.queue}
              byokMaxFileSizeMb={25}
              completedCount={batch.completedCount}
              failedCount={batch.failedCount}
              totalCount={batch.totalCount}
              isProcessing={batch.isProcessing}
              onRemoveItem={batch.removeItem}
              onCancelAll={batch.cancelAll}
              onClearQueue={() => {
                setSkippedNotice(null);
                batch.clearQueue();
              }}
              onOpenNote={(noteId) =>
                onNoteCreated?.(noteId, batchFolderId ? Number(batchFolderId) : null)
              }
            />

            {!batch.isProcessing && batch.hasPending && (
              <div className="mt-4 flex flex-col items-center gap-3">
                {folders.length > 0 && (
                  <FolderSelect
                    t={t}
                    folders={folders}
                    value={batchFolderId}
                    onChange={setBatchFolderId}
                  />
                )}
                <Button
                  onClick={startBatchProcessing}
                  disabled={!uploadAllowedByPolicy || state === "transcribing"}
                  className={PRIMARY_ACTION_CLASS}
                >
                  {t("notes.upload.transcribe")}
                </Button>
              </div>
            )}
          </div>
        )}

        {state === "selected" && file && (
          <SelectedView
            t={t}
            file={file}
            getActiveModelLabel={getActiveModelLabel}
            reset={reset}
            handleTranscribe={handleTranscribe}
            transcribeDisabled={batch.isProcessing || !uploadAllowedByPolicy}
            onOpenSettings={onOpenSettings}
          />
        )}

        {state === "transcribing" && (
          <TranscribingView
            t={t}
            progress={progress}
            getTranscribingLabel={getTranscribingLabel}
            file={file}
            chunkProgress={chunkProgress}
            onCancel={cancelTranscription}
          />
        )}

        {state === "complete" && result && (
          <CompleteView
            t={t}
            result={result}
            partialWarning={partialWarning}
            diarizationWarning={diarizationWarning}
            folders={folders}
            selectedFolderId={selectedFolderId}
            handleFolderChange={handleFolderChange}
            noteId={noteId}
            onNoteCreated={onNoteCreated}
            reset={reset}
          />
        )}

        {state === "error" && error && (
          <ErrorView
            t={t}
            error={error}
            reset={reset}
            onRetry={handleRetry}
            onOpenSettings={
              onOpenSettings && !uploadAllowedByPolicy && uploadChoiceRefusal
                ? () => onOpenSettings("uploadTranscription")
                : undefined
            }
          />
        )}

        {(state === "idle" || state === "selected") && (
          <div
            className={cn(
              CARD_SURFACE_CLASS,
              "mt-5 divide-y divide-border/60 dark:divide-white/10"
            )}
          >
            <div className="flex items-center gap-4 px-5 py-4">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Users size={16} className="mt-0.5 shrink-0 text-foreground/45" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {t("notes.upload.speakerDetection")}
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                    {t("notes.upload.speakerDetectionDescription")}
                  </p>

                  {diarizationEnabled && managedActive && (
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {t("notes.upload.diarizationRunsLocally")}
                    </p>
                  )}
                </div>
              </div>
              <Toggle
                checked={diarizationEnabled}
                disabled={diarizationDownloading}
                ariaLabel={t("notes.upload.speakerDetection")}
                onChange={async (next) => {
                  setDiarizationEnabled(next);
                  // BYOK-native diarization needs no local models — don't download them.
                  if (
                    next &&
                    !diarizationModelsReady &&
                    !shouldUseByokDiarize(buildTranscriptionConfig(), true)
                  ) {
                    const ready = await ensureDiarizationModels();
                    if (!ready) setDiarizationEnabled(false);
                  }
                }}
              />
            </div>

            {diarizationEnabled && diarizationModelsReady && (
              <div className="flex items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1 ps-7">
                  <label
                    htmlFor="upload-num-speakers"
                    className="block text-sm font-medium text-foreground"
                  >
                    {t("notes.upload.numSpeakersLabel")}
                  </label>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                    {t("notes.upload.numSpeakersHint")}
                  </p>
                </div>
                <input
                  id="upload-num-speakers"
                  type="number"
                  min="2"
                  max={MAX_SPEAKER_COUNT}
                  step="1"
                  inputMode="numeric"
                  value={diarizationNumSpeakers}
                  onKeyDown={(e) => {
                    if ([".", ",", "e", "E", "+", "-"].includes(e.key)) e.preventDefault();
                  }}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "") {
                      setDiarizationNumSpeakers("");
                      return;
                    }
                    const n = Number(raw);
                    if (!Number.isInteger(n)) return;
                    setDiarizationNumSpeakers(String(Math.max(2, Math.min(MAX_SPEAKER_COUNT, n))));
                  }}
                  placeholder={t("notes.upload.numSpeakersPlaceholder")}
                  className="h-9 w-32 shrink-0 rounded-xl! px-3 text-sm placeholder:text-foreground/45 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={showNewFolderDialog} onOpenChange={setShowNewFolderDialog}>
        <DialogContent className="sm:max-w-95">
          <DialogHeader>
            <DialogTitle>{t("notes.upload.newFolder")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/50">
              {t("notes.upload.folderName")}
            </label>
            <Input
              dir="auto"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder={t("notes.folders.folderName")}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setShowNewFolderDialog(false);
                setNewFolderName("");
              }}
            >
              {t("notes.upload.cancel")}
            </Button>
            <Button onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
              {t("notes.upload.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProgressWaveform() {
  return (
    <div className="mb-6 flex h-10 items-end justify-center gap-[3px]" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <div
          key={i}
          className="w-[3px] origin-bottom rounded-full bg-primary/60"
          style={{
            height: "100%",
            animation: `waveform-bar ${0.8 + i * 0.12}s ease-in-out infinite`,
            animationDelay: `${i * 0.08}s`,
          }}
        />
      ))}
    </div>
  );
}

// null = size unknown (no content-length): pulse a full bar instead of sitting on an empty one.
function ProgressBar({ percent }: { percent: number | null }) {
  return (
    <div className="mb-4 h-1 w-full max-w-xs overflow-hidden rounded-full bg-foreground/8 dark:bg-white/10">
      <div
        className={cn(
          "h-full rounded-full bg-primary transition-[width] duration-500 ease-out",
          percent === null && "animate-pulse"
        )}
        style={{ width: `${percent === null ? 100 : Math.min(percent, 100)}%` }}
      />
    </div>
  );
}

interface NoProviderViewProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  onOpenSettings: () => void;
}

function NoProviderView({ t, onOpenSettings }: NoProviderViewProps) {
  return (
    <EmptyStateCard
      icon={Settings}
      title={t("notes.upload.noProviderTitle")}
      description={t("notes.upload.noProviderDescription")}
      headingLevel={2}
      className="py-12"
    >
      <Button onClick={onOpenSettings} className={PRIMARY_ACTION_CLASS}>
        {t("notes.upload.noProviderAction")}
      </Button>
    </EmptyStateCard>
  );
}

interface IdleViewProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  getActiveModelLabel: () => string;
  handleDroppedFiles: (files: File[]) => void;
  handleBrowse: () => void;
  onOpenSettings?: (section: string) => void;
  disabled: boolean;
  describedBy?: string;
}

function IdleView({
  t,
  getActiveModelLabel,
  handleDroppedFiles,
  handleBrowse,
  onOpenSettings,
  disabled,
  describedBy,
}: IdleViewProps) {
  return (
    <>
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {t("notes.upload.title")}
        </h2>
        <UploadModelSettingsButton
          label={t("notes.upload.using", { model: getActiveModelLabel() })}
          actionLabel={t("notes.upload.noProviderAction")}
          onOpenSettings={onOpenSettings}
          className="text-[13px] text-muted-foreground"
        />
      </div>

      <DropZone
        label={t("notes.upload.dropOrBrowse")}
        activeLabel={t("notes.upload.dropToUpload")}
        hint={t("notes.upload.supportedFormats")}
        onFiles={handleDroppedFiles}
        onBrowse={handleBrowse}
        disabled={disabled}
        describedBy={describedBy}
      />
    </>
  );
}

interface SelectedViewProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  file: { name: string; path: string; size: string; sizeBytes: number };
  getActiveModelLabel: () => string;
  reset: () => void;
  handleTranscribe: () => void;
  transcribeDisabled: boolean;
  onOpenSettings?: (section: string) => void;
}

function SelectedView({
  t,
  file,
  getActiveModelLabel,
  reset,
  handleTranscribe,
  transcribeDisabled,
  onOpenSettings,
}: SelectedViewProps) {
  return (
    <div className="flex flex-col gap-3" style={{ animation: "float-up 0.3s ease-out" }}>
      <div className={cn(CARD_SURFACE_CLASS, "flex items-center gap-4 p-4")}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/15">
          <FileAudio size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p dir="ltr" className="truncate text-sm font-medium text-foreground">
            {file.name}
          </p>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
            {file.size && (
              <>
                <span className="shrink-0">{file.size}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <UploadModelSettingsButton
              label={getActiveModelLabel()}
              actionLabel={t("notes.upload.noProviderAction")}
              onOpenSettings={onOpenSettings}
              className="min-w-0 truncate text-start"
            />
          </div>
        </div>
        <button
          onClick={reset}
          aria-label={t("notes.upload.cancel")}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-foreground/45 transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        <Button
          onClick={handleTranscribe}
          disabled={transcribeDisabled}
          className={PRIMARY_ACTION_CLASS}
        >
          {t("notes.upload.transcribe")}
        </Button>

        <Button variant="ghost" onClick={reset} className={SECONDARY_ACTION_CLASS}>
          {t("notes.upload.cancel")}
        </Button>
      </div>
    </div>
  );
}

interface TranscribingViewProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  progress: number;
  getTranscribingLabel: () => string;
  file: { name: string; path: string; size: string; sizeBytes: number } | null;
  chunkProgress: { chunksTotal: number; chunksCompleted: number } | null;
  onCancel: () => void;
}

function TranscribingView({
  t,
  progress,
  getTranscribingLabel,
  file,
  chunkProgress,
  onCancel,
}: TranscribingViewProps) {
  const hasChunkInfo = chunkProgress !== null && chunkProgress.chunksTotal > 0;

  return (
    <div
      className={cn(CARD_SURFACE_CLASS, "flex flex-col items-center px-6 py-10 text-center")}
      style={{ animation: "float-up 0.3s ease-out" }}
    >
      <ProgressWaveform />
      <ProgressBar percent={progress} />

      <p className="text-[15px] font-medium text-foreground">{getTranscribingLabel()}</p>
      {hasChunkInfo ? (
        <p className="mt-1 text-[13px] text-muted-foreground">
          {t("notes.upload.chunkProgress", {
            completed: chunkProgress.chunksCompleted,
            total: chunkProgress.chunksTotal,
          })}
        </p>
      ) : null}
      {!hasChunkInfo && file ? (
        <p dir="ltr" className="mt-1 w-full max-w-sm truncate text-[13px] text-muted-foreground">
          {file.name}
        </p>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
        className={cn(SECONDARY_ACTION_CLASS, "mt-5")}
      >
        {t("notes.upload.cancelTranscription")}
      </Button>
    </div>
  );
}

interface FolderSelectProps {
  t: (key: string) => string;
  folders: FolderItem[];
  value: string;
  onChange: (val: string) => void;
  includeCreateNew?: boolean;
  className?: string;
}

function FolderSelect({
  t,
  folders,
  value,
  onChange,
  includeCreateNew,
  className,
}: FolderSelectProps) {
  const meetingsFolderId = folders.find(
    (f) => f.name === MEETINGS_FOLDER_NAME && !!f.is_default
  )?.id;
  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      <FolderOpen size={14} className="shrink-0 text-muted-foreground" />
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-52 rounded-full px-3.5 text-sm [&>svg]:h-3.5 [&>svg]:w-3.5">
          <SelectValue placeholder={t("notes.upload.selectFolder")} />
        </SelectTrigger>
        <SelectContent>
          {orderFoldersAsTree(folders).map((f) => {
            // The default Meetings folder takes no uploads yet, and neither do its subfolders.
            const isMeetings = f.id === meetingsFolderId || f.parent_folder_id === meetingsFolderId;
            return (
              <SelectItem
                key={f.id}
                value={String(f.id)}
                disabled={isMeetings}
                className="text-sm py-1.5 ps-2.5 pe-7 rounded-md"
              >
                <span className="flex items-center gap-1.5">
                  <span dir="auto">{folderPathLabel(f, folders, t)}</span>
                  {isMeetings && (
                    <span className="text-[9px] uppercase tracking-wider text-foreground/45 font-medium">
                      {t("notes.folders.soon")}
                    </span>
                  )}
                </span>
              </SelectItem>
            );
          })}
          {includeCreateNew && (
            <>
              <SelectSeparator />
              <SelectItem value="__create_new__" className="text-sm py-1.5 ps-2.5 pe-7 rounded-md">
                <span className="flex items-center gap-1.5 text-primary">
                  <Plus size={12} />
                  {t("notes.upload.newFolder")}
                </span>
              </SelectItem>
            </>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

interface CompleteViewProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  result: string;
  partialWarning: { failed: number; total: number } | null;
  diarizationWarning: boolean;
  folders: FolderItem[];
  selectedFolderId: string;
  handleFolderChange: (val: string) => void;
  noteId: number | null;
  onNoteCreated?: (noteId: number, folderId: number | null) => void;
  reset: () => void;
}

function CompleteView({
  t,
  result,
  partialWarning,
  diarizationWarning,
  folders,
  selectedFolderId,
  handleFolderChange,
  noteId,
  onNoteCreated,
  reset,
}: CompleteViewProps) {
  return (
    <div
      className={cn(CARD_SURFACE_CLASS, "flex flex-col items-center px-6 py-10 text-center")}
      style={{ animation: "float-up 0.3s ease-out" }}
    >
      <div className="relative w-12 h-12 mb-4">
        <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
          <circle
            cx="18"
            cy="18"
            r="15"
            fill="none"
            strokeWidth="1.5"
            className="stroke-success/20"
          />
          <circle
            cx="18"
            cy="18"
            r="15"
            fill="none"
            strokeWidth="1.5"
            className="stroke-success"
            strokeDasharray="94.25"
            strokeLinecap="round"
            style={{ animation: "ring-fill 0.8s ease-out forwards" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <svg className="w-5 h-5 text-success" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 13l4 4L19 7"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="24"
              strokeDashoffset="24"
              style={{ animation: "draw-check 0.4s ease-out 0.5s forwards" }}
            />
          </svg>
        </div>
      </div>

      <p className="text-[15px] font-medium text-foreground">
        {t("notes.upload.transcriptionComplete")}
      </p>
      <p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted-foreground line-clamp-2">
        {result.slice(0, 150)}
      </p>

      <UploadCompleteWarnings
        partialWarning={partialWarning}
        diarizationWarning={diarizationWarning}
        t={t}
      />

      {folders.length > 0 && (
        <FolderSelect
          t={t}
          folders={folders}
          value={selectedFolderId}
          onChange={handleFolderChange}
          includeCreateNew
          className="mt-5"
        />
      )}

      <div className="mt-5 flex items-center gap-2">
        {noteId != null && onNoteCreated && (
          <Button
            onClick={() =>
              onNoteCreated(noteId, selectedFolderId ? Number(selectedFolderId) : null)
            }
            className={PRIMARY_ACTION_CLASS}
          >
            {t("notes.upload.openNote")}
          </Button>
        )}
        <Button variant="ghost" onClick={reset} className={SECONDARY_ACTION_CLASS}>
          {t("notes.upload.uploadAnother")}
        </Button>
      </div>
    </div>
  );
}

interface ErrorViewProps {
  t: (key: string) => string;
  error: string;
  reset: () => void;
  onRetry: () => void;
  onOpenSettings?: () => void;
}

function ErrorView({ t, error, reset, onRetry, onOpenSettings }: ErrorViewProps) {
  return (
    <div className="flex flex-col gap-4" style={{ animation: "float-up 0.3s ease-out" }}>
      <div className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-4 dark:bg-destructive/10">
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-destructive" />
        <p className="flex-1 text-sm leading-relaxed text-destructive">{error}</p>
        <button
          onClick={reset}
          aria-label={t("common.close")}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-foreground/45 transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex items-center justify-center gap-2">
        {onOpenSettings ? (
          <Button onClick={onOpenSettings} className={PRIMARY_ACTION_CLASS}>
            {t("notes.upload.noProviderAction")}
          </Button>
        ) : (
          <Button onClick={onRetry} className={PRIMARY_ACTION_CLASS}>
            {t("notes.upload.retry")}
          </Button>
        )}
        <Button variant="ghost" onClick={reset} className={SECONDARY_ACTION_CLASS}>
          {t("notes.upload.startOver")}
        </Button>
      </div>
    </div>
  );
}
