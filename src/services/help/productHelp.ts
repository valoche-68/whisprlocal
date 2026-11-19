import topics from "../../config/productHelpTopics.json";
import { getSettings, selectResolvedLLMConfig } from "../../stores/settingsStore";
import { usePolicyStore } from "../../stores/policyStore";
import { projectHelpSettings } from "./helpContext";
import { bundledHelp, DOCS_ORIGIN } from "../../helpers/productHelpFallback";
import { isAgentAllowed } from "../../stores/policyRules";

export type HelpTopic = keyof typeof topics;
export const HELP_TOPICS = Object.keys(topics) as HelpTopic[];
export interface HelpArticle {
  title: string;
  url: string;
  path: string;
  text: string;
  untrusted?: boolean;
  excerpt?: boolean;
}
export interface HelpResult {
  source: "live" | "bundled";
  reason: "policy" | "privacy" | "rateLimit" | "unavailable" | null;
  retrievedAt: string | null;
  articles: HelpArticle[];
}
export interface HelpBasics {
  platform: string;
  version: string;
  microphonePermission: string;
  accessibilityPermission: string;
  systemAudioPermission?: string;
}

export async function lookupHelp(
  topic: HelpTopic,
  signal: AbortSignal,
  _page?: string
): Promise<HelpResult> {
  signal.throwIfAborted();
  return bundledHelp(topic, "privacy") as HelpResult;
}

/** Explicit projection, never spread settings: provider URLs, keys, notes and paths stay private. */
export interface HelpContext {
  topic: HelpTopic;
  platform: string;
  appVersion: string;
  readAt: string;
  policyStatus: string;
  values: Record<string, string | boolean | null>;
  note: string;
}

export async function getHelpContext(topic: HelpTopic): Promise<HelpContext> {
  const basics = await window.electronAPI.productHelpBasics();
  const state = getSettings();
  const policy = usePolicyStore.getState();
  const values = projectHelpSettings(
    topic,
    state as unknown as Record<string, unknown>,
    basics,
    selectResolvedLLMConfig(state, "chatIntelligence"),
    isAgentAllowed(policy)
  );
  if (topic === "assistant" || topic === "models") {
    values.voiceAssistantMode = selectResolvedLLMConfig(state, "dictationAgent").mode;
    values.cleanupMode = selectResolvedLLMConfig(state, "dictationCleanup").mode;
  }
  return {
    topic,
    platform: basics.platform,
    appVersion: basics.version,
    readAt: new Date().toISOString(),
    policyStatus: policy.status,
    values,
    note: "Read-only WhisprLocal settings and known permission state. appVersion is the application version. For activationMode, push means Hold and tap means Tap. Missing values are unknown.",
  };
}

/** Minimal durable evidence. Full documents and current settings belong only to this model turn. */
export function productHelpMetadata(
  name: string,
  data: unknown
): Record<string, unknown> | undefined {
  if (!["search_openwhispr_help", "read_openwhispr_help", "get_openwhispr_context"].includes(name))
    return undefined;
  const value = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (name === "get_openwhispr_context")
    return {
      kind: "product-help",
      sources: [],
      settingsRead: true,
      readAt: typeof value.readAt === "string" ? value.readAt : null,
    };
  const allowedPaths = new Set(Object.values(topics).flatMap((topic) => topic.paths));
  const sources = (Array.isArray(value.articles) ? value.articles : [])
    .slice(0, 8)
    .flatMap((article) => {
      if (!article?.text || !allowedPaths.has(article.path)) return [];
      return [
        {
          title: article.path.split("/").pop(),
          path: article.path,
          url: DOCS_ORIGIN,
          source: value.source === "live" ? "live" : "bundled",
          reason: ["policy", "privacy", "rateLimit", "unavailable"].includes(value.reason as string)
            ? value.reason
            : null,
        },
      ];
    });
  return { kind: "product-help", sources, readAt: null, retrievedAt: value.retrievedAt ?? null };
}
