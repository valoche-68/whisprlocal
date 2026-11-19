import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import { useSettingsStore } from "../../stores/settingsStore";
import { withHttpsScheme } from "../../utils/urlUtils";
import { AudioLines, CircleCheck, MousePointer2 } from "../icons";
import { Button } from "../ui/button";
import { ProviderCheckField } from "../ui/ProviderCheckField";
import {
  RESUME_DRAFT_PERSIST_DELAY_MS,
  type OnboardingByokDraft,
  type OnboardingByokStepId,
  type OnboardingStepId,
} from "./flow";
import { isBlankByokDraft, resolveSavedByokConfig } from "./savedByokConfig";

export function SetupStageStepper({ stepId }: { stepId: OnboardingStepId }) {
  const { t } = useTranslation();
  const assistant = stepId.endsWith("assistant");
  return (
    <div
      className="relative mx-auto flex items-start justify-between w-40"
      aria-label={t("onboarding.rehaul.provider.progress")}
    >
      <span className="absolute left-8 right-8 border-t border-dashed border-[var(--onboarding-control-border)] top-4" />
      <div className="relative z-10 flex w-14 flex-col items-center gap-1.5 text-[var(--onboarding-text-secondary)]">
        <span
          className={`flex items-center justify-center rounded-full size-8 ${
            assistant
              ? "bg-[var(--onboarding-accent)] text-[var(--onboarding-accent-foreground)]"
              : "bg-[var(--onboarding-inverse-surface)] text-[var(--onboarding-inverse-text)]"
          }`}
        >
          {assistant ? (
            <CircleCheck className="size-4" strokeWidth={2} />
          ) : (
            <AudioLines className="size-4" />
          )}
        </span>
        <span className="text-xs">{t("onboarding.rehaul.provider.dictation")}</span>
      </div>
      <div className="relative z-10 flex w-14 flex-col items-center gap-1.5 text-[var(--onboarding-text-secondary)]">
        <span
          className={`flex items-center justify-center rounded-full size-8 ${
            assistant
              ? "bg-[var(--onboarding-inverse-surface)] text-[var(--onboarding-inverse-text)]"
              : "border border-[var(--onboarding-control-border)] bg-[var(--onboarding-surface)] text-[var(--onboarding-text-primary)]"
          }`}
        >
          <MousePointer2 className="size-4" />
        </span>
        <span className="text-xs">{t("onboarding.rehaul.provider.assistant")}</span>
      </div>
    </div>
  );
}

/**
 * The card action runs on the same pill as the shell footer's primary (Figma
 * "Frame 25"): 40 tall, radius 38, Inter Medium 14/140%, on the onboarding
 * accent. Before this, each card carried its own hand-rolled
 * 32px-tall button — some on blue-500, some on neutral-950, all at regular
 * weight — so the step's own call to action read quieter than the Continue
 * button sitting right under it.
 */
function StepPrimaryAction({
  onClick,
  disabled = false,
  className = "",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-9 rounded-[38px] px-5 text-sm ${className}`}
    >
      {children}
    </Button>
  );
}

/** The card each setup mode's step renders into. Top margin is per call site. */
const SETUP_CARD_BASE_CLASS =
  "mx-auto w-full rounded-[1.125rem] border border-[var(--onboarding-control-border)] bg-[var(--onboarding-surface)] text-[var(--onboarding-text-primary)]";

export const SETUP_CARD_CLASS = `${SETUP_CARD_BASE_CLASS} max-w-[30rem] px-3 py-4`;

function endpoint(value: string): URL | null {
  try {
    const url = new URL(withHttpsScheme(value.trim()));
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url;
  } catch {
    // Incomplete endpoint drafts cannot be selected.
  }
  return null;
}

export function SelfHostedProviderStep({
  stepId,
  onProceed,
  resumeState,
  onResumeStateChange,
}: {
  stepId: OnboardingByokStepId;
  onProceed: () => void;
  resumeState?: OnboardingByokDraft;
  onResumeStateChange: (state: OnboardingByokDraft) => void;
}) {
  const { t } = useTranslation();
  const store = useSettingsStore();
  const assistant = stepId === "byok-assistant";
  const saved = resolveSavedByokConfig(stepId, store);
  const draft = resumeState && !isBlankByokDraft(resumeState) ? resumeState : saved?.draft;
  const [baseUrl, setBaseUrl] = useState(draft?.baseUrl ?? "");
  const [model, setModel] = useState(draft?.customModel ?? "");
  // A saved credential belongs to its exact endpoint. Moving to another URL
  // must not carry even a prefilled copy of that credential across.
  const savedUrl = endpoint(saved?.draft.baseUrl ?? "")?.href;
  const savedKey = assistant ? store.chatAgentCustomApiKey : store.customTranscriptionApiKey;
  const [keyDraft, setKeyDraft] = useState<string | null>(null);
  const url = endpoint(baseUrl);
  const key = keyDraft ?? (url && url.href === savedUrl ? savedKey : "");
  const latest = useRef<OnboardingByokDraft | null>(null);
  const flush = useCallback(() => {
    if (latest.current) onResumeStateChange(latest.current);
  }, [onResumeStateChange]);
  const persist = useDebouncedCallback(flush, RESUME_DRAFT_PERSIST_DELAY_MS);
  useEffect(() => {
    latest.current = { selectedProvider: "", selectedModel: "", baseUrl, customModel: model };
    persist();
  }, [baseUrl, model, persist]);
  useEffect(() => flush, [flush]);

  const select = () => {
    if (!url || !model.trim()) return;
    if (assistant) {
      store.setChatAgentRemoteUrl(url.href);
      store.setChatAgentCustomApiKey(key.trim());
      store.setChatAgentModel(model.trim());
      store.setChatAgentMode("self-hosted");
      store.setChatAgentProvider("custom");
    } else {
      store.setRemoteTranscriptionUrl(url.href);
      store.setRemoteTranscriptionModel(model.trim());
      store.setRemoteTranscriptionType("openai-compatible");
      store.setMeetingRemoteTranscriptionUrl(url.href);
      store.setMeetingRemoteTranscriptionType("openai-compatible");
      store.setUploadRemoteTranscriptionUrl(url.href);
      store.setUploadRemoteTranscriptionModel(model.trim());
      store.setCustomTranscriptionApiKey(key.trim());
      store.setCloudTranscriptionForAllScopes({
        useLocalWhisper: false,
        cloudTranscriptionMode: "byok",
        cloudTranscriptionProvider: "custom",
        cloudTranscriptionModel: model.trim(),
      });
    }
    onProceed();
  };

  return (
    <section className={`mt-5 ${SETUP_CARD_CLASS}`}>
      <SetupStageStepper stepId={stepId} />
      <div className="mt-3 space-y-3">
        <ProviderCheckField
          label={t("onboarding.rehaul.provider.endpointUrl")}
          value={baseUrl}
          onChange={(event) => {
            setBaseUrl(event.target.value);
            setKeyDraft(null);
          }}
          placeholder={t("onboarding.rehaul.provider.endpointPlaceholder")}
        />
        <ProviderCheckField
          label={t("onboarding.rehaul.provider.apiKey")}
          type="password"
          value={key}
          onChange={(event) => setKeyDraft(event.target.value)}
          placeholder={t("onboarding.rehaul.provider.optional")}
          autoComplete="off"
          spellCheck={false}
        />
        <ProviderCheckField
          label={t("onboarding.rehaul.provider.modelId")}
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder={t("onboarding.rehaul.provider.modelIdPlaceholder")}
        />
        <StepPrimaryAction
          onClick={select}
          disabled={!url || !model.trim()}
          className="mt-4! w-full"
        >
          {t("onboarding.rehaul.provider.proceed")}
        </StepPrimaryAction>
      </div>
    </section>
  );
}
