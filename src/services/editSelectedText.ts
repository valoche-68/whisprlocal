import ReasoningService from "./ReasoningService";
import type { ReasoningConfig } from "./BaseReasoningService";
import { cancelRequest, trackRequest } from "./ai/requestCancellation";
import i18n from "../i18n";
import { getSettings } from "../stores/settingsStore";
import { resolveChatStreamingInference } from "../helpers/dictationAgentInference";
import {
  buildLocalSelectionEditSystemPrompt,
  buildLocalSelectionEditUserPrompt,
  buildSelectionEditSystemPrompt,
  buildSelectionEditUserPrompt,
  createSelectionCompletionMarker,
  extractLocalSelectionEditReplacement,
  extractSelectionEditReplacement,
  isSelectionQuestionResponse,
  SELECTION_EDIT_RESPONSE_FORMAT,
} from "../helpers/selectionEditing";
import { resolvePrompt } from "../config/prompts";
import { getDictionaryHintWords } from "../utils/snippets";
import { getAgentName } from "../utils/agentName";
import { resolveDictationToneStyle, type ToneAppCategory } from "../config/toneStyle";
import { selectionEditToneSentence } from "../config/prompts/toneStyle";
import type { ChatImageAttachment } from "../components/chat/types";

/** Null means the instruction asks about the selection; answer it in chat. */
export async function editSelectedText(
  instruction: string,
  selectedText: string,
  {
    appCategory,
    signal,
  }: {
    attachment?: ChatImageAttachment | null;
    appCategory?: ToneAppCategory | null;
    signal: AbortSignal;
  }
): Promise<string | null> {
  const settings = getSettings();
  const agentName = getAgentName();
  const { config: target } = resolveChatStreamingInference(settings, {
    inferenceScope: "dictationAgent",
  });
  const local = target.mode === "local";
  const lanUrl = target.mode === "self-hosted" ? target.remoteUrl?.trim() : undefined;
  if (!local && !lanUrl) {
    throw Object.assign(new Error(i18n.t("notes.actions.errors.noEndpoint")), {
      code: "LOCAL_ONLY",
    });
  }
  const marker = local ? "" : createSelectionCompletionMarker();
  const dictionary = getDictionaryHintWords(settings);
  const toneSentence = settings.toneStyleEnabled
    ? selectionEditToneSentence(resolveDictationToneStyle(settings.toneStyles, appCategory ?? null))
    : "";
  const systemPrompt = local
    ? buildLocalSelectionEditSystemPrompt({
        customPrompt: settings.customPrompts.dictationAgent.replaceAll("{{agentName}}", agentName),
        dictionary,
        toneSentence,
      })
    : buildSelectionEditSystemPrompt(
        [
          resolvePrompt("dictationAgent", {
            agentName,
            language: settings.preferredLanguage,
            customDictionary: dictionary,
            uiLanguage: settings.uiLanguage,
          }),
          toneSentence,
        ]
          .filter(Boolean)
          .join("\n\n"),
        marker
      );
  const requestId = crypto.randomUUID();
  const config: ReasoningConfig = {
    inferenceScope: "dictationAgent",
    requiresAgent: true,
    provider: local ? "local" : "lan",
    lanUrl,
    customApiKey: local ? undefined : target.customApiKey,
    disableThinking: local || target.disableThinking,
    reasoningEffort: target.reasoningEffort,
    systemPrompt,
    maxTokens: 8192,
    contextSize: 16384,
    temperature: 0.2,
    requireCompleteOutput: true,
    ...(local
      ? { responseFormat: { ...SELECTION_EDIT_RESPONSE_FORMAT, type: "json_object" as const } }
      : {}),
    requestId,
  };
  const cancel = (): void => {
    cancelRequest(requestId);
    if (local) void window.electronAPI?.cancelLocalReasoning?.(requestId);
  };
  signal.throwIfAborted();
  const release = trackRequest(requestId);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const result = await ReasoningService.processText(
      local
        ? buildLocalSelectionEditUserPrompt(instruction, selectedText)
        : buildSelectionEditUserPrompt(instruction, selectedText),
      target.model,
      agentName,
      config
    );
    signal.throwIfAborted();
    if (isSelectionQuestionResponse(result, marker)) return null;
    return local
      ? extractLocalSelectionEditReplacement(result)
      : extractSelectionEditReplacement(result, marker);
  } finally {
    signal.removeEventListener("abort", cancel);
    release();
  }
}
