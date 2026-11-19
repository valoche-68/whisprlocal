import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import UseCaseStep from "./onboarding/UseCaseStep";
import { hasUseCaseIntent } from "./onboarding/useCases";
import OnboardingShell, { OnboardingStepHeader } from "./onboarding/OnboardingShell";
import CompactPermissionsStep from "./onboarding/CompactPermissionsStep";
import LanguageSelectionStep from "./onboarding/LanguageSelectionStep";
import ShortcutSetupStep from "./onboarding/ShortcutSetupStep";
import AssistantHotkeyPreview from "./onboarding/AssistantHotkeyPreview";
import DemoStep from "./onboarding/DemoStep";
import SetupChoiceStep from "./onboarding/SetupChoiceStep";
import { SelfHostedProviderStep } from "./onboarding/ProviderSetupStep";
import {
  LocalSetupStep,
  LocalSetupStepPlaceholder,
  LocalSetupSubtitlePlaceholder,
} from "./onboarding/LocalSetupStep";
import { planLocalSetup, proceedWithLocalSetup } from "./onboarding/localSetupFlow";
import { localSetupComputerName, localSetupLanguageLabel } from "./onboarding/localSetupLabels";
import { useLocalSetupSpace } from "./onboarding/useLocalSetupSpace";
import { AlertDialog } from "./ui/dialog";
import { useToast } from "./ui/useToast";
import { usePermissions } from "../hooks/usePermissions";
import { useClipboard } from "../hooks/useClipboard";
import { useSystemAudioPermission } from "../hooks/useSystemAudioPermission";
import { useSettings } from "../hooks/useSettings";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { useHotkeyModeInfo } from "../hooks/useHotkeyModeInfo";
import { useComputerProfile } from "../hooks/useComputerProfile";
import { useRegistryVersion } from "../hooks/useRegistryVersion";
import { usePolicySnapshot } from "../hooks/usePolicy";
import { usePolicyStore } from "../stores/policyStore";
import { isAgentAllowed } from "../stores/policyRules";
import { useSettingsStore } from "../stores/settingsStore";
import { localSetupMinimumSpaceGb, type LocalSetupPlan } from "../config/localSetup";
import type { LocalSetupHandOff } from "./onboarding/useLocalSetupDownloads";
import { getDefaultHotkey, parseHotkeyList, serializeHotkeyList } from "../utils/hotkeys";
import {
  DEFAULT_ASSISTANT_ONBOARDING_HOTKEY,
  formatHotkeyInstruction,
  getRecommendedDictationHotkeys,
  resolveOnboardingAssistantHotkey,
  resolveOnboardingDictationHotkey,
} from "./onboarding/hotkeyPresentation";
import { getValidationMessage } from "../utils/hotkeyValidator";
import { validateHotkeyForSlot } from "../utils/hotkeyValidation";
import { getPlatform } from "../utils/platform";
import { ACCESSIBILITY_SKIPPED_KEY, areRequiredPermissionsMet } from "../utils/permissions";
import logger from "../utils/logger";
import {
  COMPACT_STEPS,
  getNextOnboardingStep,
  getOnboardingProgress,
  getOnboardingRoute,
  getOnboardingWindowMode,
  reconcileStepWithRoute,
  shouldInitializeMacAccessibilityFeatures,
  type OnboardingByokDraft,
  type OnboardingResumeState,
  type OnboardingSetupMode,
  type OnboardingStepId,
} from "./onboarding/flow";
import { useOnboardingSession } from "./onboarding/useOnboardingSession";
import { usePermissionGuide } from "./onboarding/usePermissionGuide";
import {
  requestMicrophoneForGuide,
  type GuidePermission,
} from "./onboarding/permissionGuideController";
import { discardPendingLocalSetup } from "./onboarding/pendingLocalModels";
import { resolveAssistantDemoScenario } from "./onboarding/assistantDemoScenario";
import { ActivationModeSelector } from "./ui/ActivationModeSelector";
import LinuxPttSetupInfo from "./ui/LinuxPttSetupInfo";

interface OnboardingFlowProps {
  onComplete: (options?: { openSettings?: boolean; setupMode?: OnboardingCompletionMode }) => void;
}

type OnboardingCompletionMode = Exclude<OnboardingSetupMode, null | "cloud">;

function DemoHotkeyDescription({ text, hotkey }: { text: string; hotkey: string }) {
  const hotkeyStart = text.indexOf(hotkey);
  if (hotkeyStart < 0) return text;

  return (
    <>
      {text.slice(0, hotkeyStart)}
      <kbd className="mx-0.5 inline-flex rounded-md bg-[color-mix(in_srgb,var(--onboarding-accent)_12%,transparent)] px-1.5 py-0.5 font-semibold text-[var(--onboarding-accent)]">
        {hotkey}
      </kbd>
      {text.slice(hotkeyStart + hotkey.length)}
    </>
  );
}

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const { t, i18n } = useTranslation();
  const platform = getPlatform();
  // Read as onboarding opens, so it has long landed by the local setup step.
  const computerProfile = useComputerProfile();
  const registryVersion = useRegistryVersion();
  const agentAllowed = usePolicyStore(isAgentAllowed);
  const settings = useSettings();
  const settingsStore = useSettingsStore();
  const {
    session,
    setSession,
    goTo,
    goBack,
    setSetupMode,
    setSelfHostedRequested,
    setPermissionGuide,
    clearSession,
  } = useOnboardingSession();

  const { dictationHotkeyConfirmed, assistantHotkeyConfirmed } = session.resume;
  const [dictationHotkey, setDictationHotkey] = useState(() =>
    resolveOnboardingDictationHotkey({
      platform,
      savedHotkey: parseHotkeyList(settings.dictationKey)[0] ?? "",
      platformDefault: getDefaultHotkey(),
      confirmed: dictationHotkeyConfirmed,
    })
  );
  const [assistantHotkey, setAssistantHotkey] = useState(() =>
    resolveOnboardingAssistantHotkey(parseHotkeyList(settings.voiceAgentKey)[0] ?? "")
  );
  // Seeded from main rather than getDefaultHotkey(): main already knows when the
  // platform default can't bind (GNOME/X11 reject modifier-only combos) and
  // registered a fallback instead — recommending the unregistrable default would
  // make every confirm of it fail.
  const [recommendedDictationHotkey, setRecommendedDictationHotkey] = useState(getDefaultHotkey);
  const dictationDemoSuccess = session.resume.dictationDemoCompleted;
  const assistantDemoSuccess = session.resume.assistantDemoCompleted;
  const [isFinishing, setIsFinishing] = useState(false);
  const { toast, dismiss } = useToast();
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const fatalErrorToastRef = useRef<string | null>(null);
  // An error stays up until the next attempt replaces or clears it.
  const showFatalError = useCallback(
    (message: string | null) => {
      if (fatalErrorToastRef.current) dismissRef.current(fatalErrorToastRef.current);
      fatalErrorToastRef.current = message
        ? toast({ description: message, variant: "destructive", duration: 0 })
        : null;
    },
    [toast]
  );
  useEffect(() => () => showFatalError(null), [showFatalError]);
  const [permissionAlert, setPermissionAlert] = useState<{
    title: string;
    description: string;
  } | null>(null);
  const [, setAccessibilitySkipped] = useLocalStorage(ACCESSIBILITY_SKIPPED_KEY, false);

  const updateResumeFlag = useCallback(
    (
      key: Extract<
        keyof OnboardingResumeState,
        | "dictationHotkeyConfirmed"
        | "assistantHotkeyConfirmed"
        | "dictationDemoCompleted"
        | "assistantDemoCompleted"
      >,
      value: boolean
    ) => {
      setSession((current) => ({
        ...current,
        resume: { ...current.resume, [key]: value },
      }));
    },
    [setSession]
  );
  const setDictationHotkeyConfirmed = useCallback(
    (confirmed: boolean) => updateResumeFlag("dictationHotkeyConfirmed", confirmed),
    [updateResumeFlag]
  );
  const setAssistantHotkeyConfirmed = useCallback(
    (confirmed: boolean) => updateResumeFlag("assistantHotkeyConfirmed", confirmed),
    [updateResumeFlag]
  );
  const setDictationDemoSuccess = useCallback(
    (successful: boolean) => updateResumeFlag("dictationDemoCompleted", successful),
    [updateResumeFlag]
  );
  const setAssistantDemoSuccess = useCallback(
    (successful: boolean) => updateResumeFlag("assistantDemoCompleted", successful),
    [updateResumeFlag]
  );
  useClipboard((dialog) =>
    setPermissionAlert({ title: dialog.title, description: dialog.description })
  );
  const systemAudio = useSystemAudioPermission();
  const {
    supportsPushToTalk,
    pushToTalkUnavailableReason,
    linuxInputAccessDenied,
    loaded: hotkeyModeLoaded,
  } = useHotkeyModeInfo("onboarding", dictationHotkey);
  const { activationMode, setActivationMode } = settings;
  // The local setup's picks; null until the computer read and the policy have
  // resolved (see planLocalSetup), and the step shows its empty frame meanwhile.
  const policy = usePolicySnapshot();
  const computedLocalSetupPlan = useMemo(
    () =>
      planLocalSetup({
        profile: computerProfile,
        policy,
        guest: false,
        spokenLanguages: settings.spokenLanguages,
        requiredModelIds: [],
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the catalog changes in place; its version is the signal
    [computerProfile, policy, settings.spokenLanguages, registryVersion]
  );
  // A policy refresh that is loading or failed must not take a built plan away:
  // the step would unmount and cancel its downloads. The last plan stands until a
  // resolved policy builds the next one.
  const [latchedLocalSetupPlan, setLatchedLocalSetupPlan] = useState<LocalSetupPlan | null>(null);
  if (computedLocalSetupPlan && computedLocalSetupPlan !== latchedLocalSetupPlan) {
    setLatchedLocalSetupPlan(computedLocalSetupPlan);
  }
  const localSetupPlan = computedLocalSetupPlan ?? latchedLocalSetupPlan;

  const route = useMemo(
    () => getOnboardingRoute({ authPath: "guest", setupMode: session.setupMode, agentAllowed }),
    [agentAllowed, session.setupMode]
  );
  const currentStepId = reconcileStepWithRoute(session.currentStepId, route);

  // The space the Local card quotes: dictation alone, with the room its download
  // reserves to unpack. Undefined until both reads land; the card has a default.
  // Read once as onboarding opens, so the card's figure is ready when it shows; it
  // is read again on focus only around the choice, not on every onboarding step.
  const { space: localSetupSpace } = useLocalSetupSpace(
    currentStepId === "setup-choice" || currentStepId === "local-setup"
  );
  const localSpaceGb = useMemo(() => {
    if (!localSetupPlan || !localSetupSpace) return undefined;
    return localSetupMinimumSpaceGb(localSetupPlan, localSetupSpace.factors);
  }, [localSetupPlan, localSetupSpace]);
  const compact = COMPACT_STEPS.has(currentStepId);
  const windowMode = getOnboardingWindowMode(currentStepId);
  const permissions = usePermissions(
    (dialog) => setPermissionAlert({ title: dialog.title, description: dialog.description }),
    {
      macAccessibilityChecksEnabled: shouldInitializeMacAccessibilityFeatures(currentStepId),
    }
  );
  const openSettings =
    (open: () => Promise<{ success: boolean; error?: string }>) => async (): Promise<void> => {
      const result = await open();
      if (!result.success) throw new Error(result.error);
    };
  const openMicrophoneSettings = openSettings(window.electronAPI.openMicrophoneSettings);
  const openAccessibilitySettings = openSettings(window.electronAPI.openAccessibilitySettings);
  const guideRows: GuidePermission[] = [
    {
      id: "microphone",
      request: async () => {
        const result = await requestMicrophoneForGuide({
          requestAccess: window.electronAPI.requestMicrophoneAccess,
          checkAccess: window.electronAPI.checkMicrophoneAccess,
          openSettings: openMicrophoneSettings,
        });
        permissions.setMicPermissionGranted(result.granted);
      },
      check: async () => {
        const result = await window.electronAPI.checkMicrophoneAccess();
        permissions.setMicPermissionGranted(result.granted);
        return result;
      },
      openSettings: openMicrophoneSettings,
    },
    {
      id: "accessibility",
      request: openAccessibilitySettings,
      check: async () => {
        const granted = await window.electronAPI.checkAccessibilityPermission(true);
        permissions.setAccessibilityPermissionGranted(granted);
        return { granted };
      },
      openSettings: openAccessibilitySettings,
    },
  ];
  if (systemAudio.mode === "native")
    guideRows.push({
      id: "system-audio",
      request: systemAudio.request,
      check: async () => {
        await systemAudio.check();
        return window.electronAPI.checkSystemAudioAccess();
      },
      verify: async () => {
        const result = await window.electronAPI.verifySystemAudioAccess();
        await systemAudio.check();
        return result;
      },
      openSettings: openSettings(window.electronAPI.openSystemAudioSettings),
    });
  const guideReady = platform === "darwin" && systemAudio.loaded;
  const permissionGuide = usePermissionGuide({
    enabled: currentStepId === "permissions" && guideReady,
    progress: session.permissionGuide,
    save: setPermissionGuide,
    dismissed: () => setPermissionGuide(null),
    rows: guideRows,
  });

  useEffect(() => {
    if (currentStepId !== "permissions" && session.permissionGuide) setPermissionGuide(null);
  }, [currentStepId, session.permissionGuide, setPermissionGuide]);
  const updateCurrentByokDraft = useCallback(
    (state: OnboardingByokDraft) => {
      if (currentStepId !== "byok-dictation" && currentStepId !== "byok-assistant") return;
      setSession((current) => ({
        ...current,
        resume: {
          ...current.resume,
          byok: { ...current.resume.byok, [currentStepId]: state },
        },
      }));
    },
    [currentStepId, setSession]
  );

  // New users default to hold-to-talk, but only where no mode was ever chosen
  // (the store's "tap" is a fallback) and once main has confirmed this desktop
  // supports it — the hook's placeholder says yes on every platform.
  useEffect(() => {
    if (currentStepId !== "dictation-hotkey" || !hotkeyModeLoaded) return;
    if (supportsPushToTalk && localStorage.getItem("activationMode") === null) {
      setActivationMode("push");
    }
  }, [currentStepId, hotkeyModeLoaded, setActivationMode, supportsPushToTalk]);

  useEffect(() => {
    if (session.currentStepId !== currentStepId) {
      setSession((current) => ({ ...current, currentStepId }));
    }
  }, [currentStepId, session.currentStepId, setSession]);

  // AppRouter releases this only after it has committed the normal app. Keeping
  // the gate active across this component's unmount prevents a one-frame flash
  // of the dictation pill or another normal-app overlay at completion/error.
  useEffect(() => {
    void window.electronAPI?.setOnboardingActive?.(true);
  }, []);

  useEffect(() => {
    void window.electronAPI?.setOnboardingWindowMode?.(windowMode);
  }, [windowMode]);

  useEffect(() => {
    if (platform === "darwin" && shouldInitializeMacAccessibilityFeatures(currentStepId)) {
      window.electronAPI?.markMacAccessibilityFeaturesReady?.();
    }
  }, [currentStepId, platform]);

  // Track main's actual registration: the platform default may be unregistrable
  // (GNOME gsettings and X11 reject modifier-only combos like Control+Super), in
  // which case main silently registered FALLBACK_HOTKEYS instead. Recommend and
  // teach the key that really works, not the one that always errors.
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI
      ?.getEffectiveDefaultHotkey?.()
      .then((key) => {
        const effective = key && parseHotkeyList(key)[0];
        if (cancelled || !effective) return;
        setRecommendedDictationHotkey(effective);
        // finalizeOnboarding registers dictationHotkey without further input on
        // routes that never show the hotkey step, so an unregistrable renderer
        // default has to be replaced here, not just in the recommendation.
        setDictationHotkey((current) => (current === getDefaultHotkey() ? effective : current));
      })
      .catch((error) =>
        logger.warn("Failed to read effective default hotkey", { error }, "onboarding")
      );
    const unsubscribe = window.electronAPI?.onHotkeyFallbackUsed?.((data) => {
      const fallback = parseHotkeyList(data?.fallback)[0];
      if (!fallback) return;
      setDictationHotkey(fallback);
      setRecommendedDictationHotkey(fallback);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const withExtraDictationHotkeys = useCallback(
    (primary: string) =>
      serializeHotkeyList([primary, ...parseHotkeyList(settings.dictationKey).slice(1)]),
    [settings.dictationKey]
  );

  const hotkeyErrorRef = useRef<string | null>(null);
  const { registerHotkey, isRegistering } = useHotkeyRegistration({
    onSuccess: (registered) => {
      const primary = parseHotkeyList(registered)[0] || registered;
      setDictationHotkey(primary);
      settings.setDictationKey(registered);
    },
    onError: (message) => {
      hotkeyErrorRef.current = message;
    },
    showSuccessToast: false,
    showErrorToast: false,
  });

  const validateDictationHotkey = useCallback(
    (value: string) => getValidationMessage(value, platform),
    [platform]
  );
  const validateAssistantHotkey = useCallback(
    (value: string) =>
      validateHotkeyForSlot(
        value,
        { "settingsPage.general.hotkey.title": withExtraDictationHotkeys(dictationHotkey) },
        t
      ),
    [dictationHotkey, t, withExtraDictationHotkeys]
  );

  const confirmDictationHotkey = useCallback(
    async (value: string) => {
      // A key the OS cannot see released falls back to Tap rather than failing
      // the pick; the card below shows Hold disabled with the reason.
      if (activationMode === "push") {
        const info = await window.electronAPI?.getHotkeyModeInfo?.(value);
        if (info && !info.supportsPushToTalk) setActivationMode("tap");
      }
      hotkeyErrorRef.current = null;
      const registered = await registerHotkey(withExtraDictationHotkeys(value));
      return registered ? null : (hotkeyErrorRef.current ?? t("onboarding.rehaul.hotkey.inUse"));
    },
    [activationMode, registerHotkey, setActivationMode, t, withExtraDictationHotkeys]
  );

  const confirmAssistantHotkey = useCallback(
    async (value: string) => {
      const result = await settings.setVoiceAgentKey(
        serializeHotkeyList([value, ...parseHotkeyList(settings.voiceAgentKey).slice(1)])
      );
      return result.success ? null : result.message || t("onboarding.rehaul.hotkey.inUse");
    },
    [settings, t]
  );

  const finalizeOnboarding = useCallback(
    async (mode: OnboardingCompletionMode) => {
      if (isFinishing) return;
      setIsFinishing(true);
      showFatalError(null);
      try {
        const registered = await registerHotkey(withExtraDictationHotkeys(dictationHotkey));
        if (!registered) {
          showFatalError(t("onboarding.hotkey.couldNotRegisterDescription"));
          return;
        }

        await window.electronAPI?.saveAllKeysToEnv?.();
        await window.electronAPI?.markBundleMigrated?.();
        await window.electronAPI?.setOnboardingWindowMode?.("restore");

        if (mode !== "local") discardPendingLocalSetup();

        clearSession();
        localStorage.setItem("onboardingCompleted", "true");
        onComplete({ setupMode: mode });
      } catch (error) {
        logger.error("Failed to finish onboarding", { error }, "onboarding");
        showFatalError(t("common.unknownError"));
      } finally {
        setIsFinishing(false);
      }
    },
    [
      clearSession,
      dictationHotkey,
      isFinishing,
      onComplete,
      registerHotkey,
      showFatalError,
      t,
      withExtraDictationHotkeys,
    ]
  );

  const applyReasoningSelectionToAllScopes = useCallback(
    (mode: "byok") => {
      // getState(), not the render-time snapshot: the BYOK step writes
      // chatAgentProvider/chatAgentModel via switchReasoningProvider and calls
      // onProceed() in the same tick, so `settingsStore` here still holds the
      // values from before the pick. Reading it stale configured the other three
      // scopes to the defaults (groq / openai/gpt-oss-120b) with no key.
      const {
        chatAgentProvider,
        chatAgentModel,
        chatAgentCloudBaseUrl,
        chatAgentRemoteUrl,
        chatAgentCustomApiKey,
      } = useSettingsStore.getState();
      settingsStore.setCloudReasoningForAllScopes({
        cleanupCloudMode: mode,
        cleanupProvider: chatAgentProvider,
        cleanupModel: chatAgentModel,
        cleanupCloudBaseUrl: chatAgentCloudBaseUrl,
        cleanupRemoteUrl: chatAgentRemoteUrl,
        // Only a self-hosted or custom endpoint has one; an empty write would
        // just churn five secure-store entries.
        ...(chatAgentCustomApiKey ? { cleanupCustomApiKey: chatAgentCustomApiKey } : {}),
        useCleanupModel: true,
        useDictationAgent: true,
      });
    },
    [settingsStore]
  );

  // Apply ready selections and hand unfinished downloads to the tray before
  // the optional dictation and assistant practice steps.
  const proceedLocalSetup = useCallback(
    async (handOff: () => LocalSetupHandOff) => {
      if (!localSetupPlan) return;
      await proceedWithLocalSetup(localSetupPlan, handOff, async (beforeContinue) => {
        discardPendingLocalSetup();
        beforeContinue();
        goTo("dictation-demo");
      });
    },
    [goTo, localSetupPlan]
  );

  const handleSetupSelection = useCallback(
    (mode: OnboardingCompletionMode) => {
      setSetupMode(mode);
      setSelfHostedRequested(mode === "byok");
      goTo(mode === "local" ? "local-setup" : "byok-dictation");
    },
    [goTo, setSelfHostedRequested, setSetupMode]
  );

  const continueFromCurrentStep = useCallback(async () => {
    // An error from an earlier failed attempt must not outlive the retry.
    showFatalError(null);
    if (currentStepId === "permissions") {
      if (platform === "darwin" && !permissions.accessibilityPermissionGranted) {
        setAccessibilitySkipped(true);
      }
    } else if (currentStepId === "languages") {
      settings.setPreferredLanguage(
        settings.spokenLanguages.length === 1 ? settings.spokenLanguages[0] : "auto"
      );
    } else if (currentStepId === "dictation-hotkey") {
      const registered = await registerHotkey(withExtraDictationHotkeys(dictationHotkey));
      if (!registered) {
        showFatalError(t("onboarding.hotkey.couldNotRegisterDescription"));
        return;
      }
      setDictationHotkeyConfirmed(true);
    } else if (currentStepId === "assistant-hotkey") {
      if (parseHotkeyList(settings.voiceAgentKey)[0] !== assistantHotkey) {
        const result = await settings.setVoiceAgentKey(
          serializeHotkeyList([
            assistantHotkey,
            ...parseHotkeyList(settings.voiceAgentKey).slice(1),
          ])
        );
        if (!result.success) {
          showFatalError(result.message || t("onboarding.rehaul.hotkey.inUse"));
          return;
        }
      }
    } else if (currentStepId === "byok-dictation") {
      // When policy disallows the assistant, its step is off-route and no
      // LLM gets configured. Turn cleanup off so dictations do not route to a
      // default provider with no credential behind it.
      if (!route.includes("byok-assistant")) {
        settingsStore.updateCleanupSettings({ useCleanupModel: false });
      }
    } else if (currentStepId === "byok-assistant") {
      applyReasoningSelectionToAllScopes("byok");
    }

    const next = getNextOnboardingStep(currentStepId, route);
    if (next) {
      goTo(next);
      return;
    }

    if (session.setupMode === "local" || session.setupMode === "byok") {
      await finalizeOnboarding(session.setupMode);
    }
  }, [
    applyReasoningSelectionToAllScopes,
    assistantHotkey,
    currentStepId,
    dictationHotkey,
    finalizeOnboarding,
    goTo,
    permissions.accessibilityPermissionGranted,
    platform,
    registerHotkey,
    route,
    session.setupMode,
    setAccessibilitySkipped,
    setDictationHotkeyConfirmed,
    settings,
    settingsStore,
    showFatalError,
    t,
    withExtraDictationHotkeys,
  ]);

  const canContinue = (() => {
    switch (currentStepId) {
      case "permissions":
        return areRequiredPermissionsMet(permissions.micPermissionGranted);
      case "languages":
        return settings.spokenLanguages.length > 0;
      case "use-cases":
        return hasUseCaseIntent(settings.onboardingUseCases, settings.onboardingUseCaseNote);
      case "dictation-hotkey":
        return dictationHotkeyConfirmed;
      case "dictation-demo":
        return dictationDemoSuccess;
      case "assistant-hotkey":
        return assistantHotkeyConfirmed;
      case "assistant-demo":
        return assistantDemoSuccess;
      default:
        return true;
    }
  })();

  const renderStep = () => {
    switch (currentStepId) {
      case "permissions":
        return (
          <CompactPermissionsStep
            permissions={permissions}
            guide={{ ...permissionGuide, ready: guideReady }}
            systemAudio={systemAudio}
            onBack={session.history.length > 0 ? goBack : undefined}
            onContinue={() => void continueFromCurrentStep()}
          />
        );

      case "languages":
        return (
          <div className="flex h-full min-h-0 w-full flex-col pt-1">
            <OnboardingStepHeader
              title={t("onboarding.rehaul.languages.title")}
              titleLines={[
                t("onboarding.rehaul.languages.titleLineOne"),
                t("onboarding.rehaul.languages.titleLineTwo"),
              ]}
              description={t("onboarding.rehaul.languages.description")}
            />
            <LanguageSelectionStep
              selected={settings.spokenLanguages}
              onChange={settings.setSpokenLanguages}
              searchPlaceholder={t("languageSelector.searchPlaceholder")}
              noResultsLabel={t("languageSelector.noLanguagesFound")}
              selectedLabel={t("onboarding.rehaul.languages.title")}
            />
          </div>
        );

      case "use-cases":
        return (
          <div className="h-full w-full pt-1">
            <UseCaseStep
              useCases={settings.onboardingUseCases}
              onUseCasesChange={settings.setOnboardingUseCases}
              note={settings.onboardingUseCaseNote}
              onNoteChange={settings.setOnboardingUseCaseNote}
            />
          </div>
        );

      case "dictation-hotkey":
      case "assistant-hotkey": {
        const assistant = currentStepId === "assistant-hotkey";
        return (
          <div className="flex h-full min-h-0 w-full flex-col pt-2">
            <OnboardingStepHeader
              title={t(
                assistant
                  ? "onboarding.rehaul.assistantHotkey.title"
                  : "onboarding.rehaul.dictationHotkey.title"
              )}
              // The assistant step's preview image needs the room a two-line header takes.
              titleLines={
                assistant
                  ? undefined
                  : [
                      t("onboarding.rehaul.dictationHotkey.titleLineOne"),
                      t("onboarding.rehaul.dictationHotkey.titleLineTwo"),
                    ]
              }
              wideTitle={assistant}
              wideDescription={assistant}
              description={t(
                assistant
                  ? "onboarding.rehaul.assistantHotkey.description"
                  : "onboarding.rehaul.dictationHotkey.description"
              )}
            />
            {assistant && <AssistantHotkeyPreview />}
            <ShortcutSetupStep
              value={assistant ? assistantHotkey : dictationHotkey}
              initiallyConfirmed={assistant ? assistantHotkeyConfirmed : dictationHotkeyConfirmed}
              onChange={(value) => {
                if (assistant) {
                  setAssistantHotkey(value);
                  setAssistantHotkeyConfirmed(true);
                } else {
                  setDictationHotkey(value);
                  setDictationHotkeyConfirmed(true);
                }
              }}
              onClearSelection={() => {
                if (assistant) {
                  setAssistantHotkey("");
                  setAssistantHotkeyConfirmed(false);
                } else {
                  setDictationHotkey("");
                  setDictationHotkeyConfirmed(false);
                }
              }}
              recommended={
                assistant
                  ? DEFAULT_ASSISTANT_ONBOARDING_HOTKEY
                  : getRecommendedDictationHotkeys(platform, recommendedDictationHotkey)
              }
              captureLabel={t("onboarding.rehaul.hotkey.capture")}
              recommendedLabel={t("common.recommended")}
              chooseAnotherLabel={t("onboarding.rehaul.hotkey.chooseAnother")}
              validate={assistant ? validateAssistantHotkey : validateDictationHotkey}
              onConfirm={assistant ? confirmAssistantHotkey : confirmDictationHotkey}
              dense={assistant}
            />
            {!assistant && (
              <div className="mx-auto mt-8 w-full max-w-md rounded-2xl border border-[var(--onboarding-control-border)] bg-[var(--onboarding-surface)] px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 text-start">
                    <p className="text-sm font-medium leading-5 text-[var(--onboarding-text-primary)]">
                      {t("onboarding.rehaul.dictationHotkey.activation")}
                    </p>
                    <p className="text-sm leading-5 text-[var(--onboarding-text-secondary)]">
                      {t(
                        activationMode === "push"
                          ? "onboarding.activation.holdDescription"
                          : "onboarding.activation.tapDescription"
                      )}
                    </p>
                  </div>
                  <ActivationModeSelector
                    variant="onboarding"
                    value={activationMode}
                    onChange={setActivationMode}
                    pushDisabledReason={pushToTalkUnavailableReason ?? undefined}
                  />
                </div>
                {/* Denied input access gets the setup box below instead. */}
                {pushToTalkUnavailableReason && !linuxInputAccessDenied && (
                  <p className="mt-2 text-start text-xs leading-[1.4] text-[var(--onboarding-text-secondary)]">
                    {pushToTalkUnavailableReason}
                  </p>
                )}
                {platform === "linux" && (activationMode === "push" || linuxInputAccessDenied) && (
                  <LinuxPttSetupInfo isAvailable={!linuxInputAccessDenied} />
                )}
              </div>
            )}
          </div>
        );
      }

      case "dictation-demo":
      case "assistant-demo": {
        const assistant = currentStepId === "assistant-demo";
        const scenario = resolveAssistantDemoScenario({
          calendarConnected: false,
          screenContextActive: false,
        });
        const hotkeyInstruction = formatHotkeyInstruction(
          assistant ? assistantHotkey : dictationHotkey
        );
        const description = t(
          assistant
            ? `onboarding.rehaul.assistantDemo.scenarios.${scenario}.description`
            : activationMode === "push"
              ? "onboarding.activation.holdHotkey"
              : "onboarding.rehaul.dictationDemo.description",
          // Formatted for reading: the raw accelerator would show internal
          // syntax like "GLOBE" or "CommandOrControl+Shift+Space".
          { hotkey: hotkeyInstruction }
        );
        return (
          <div className="h-full w-full pt-2">
            <OnboardingStepHeader
              title={t(
                assistant
                  ? "onboarding.rehaul.assistantDemo.title"
                  : "onboarding.rehaul.dictationDemo.title"
              )}
              // The assistant demo's card is tall, so its title runs one line.
              titleLines={
                assistant
                  ? undefined
                  : [
                      t("onboarding.rehaul.dictationDemo.titleLineOne"),
                      t("onboarding.rehaul.dictationDemo.titleLineTwo"),
                    ]
              }
              wideTitle={assistant}
              description={<DemoHotkeyDescription text={description} hotkey={hotkeyInstruction} />}
            />
            <DemoStep
              kind={assistant ? "assistant" : "dictation"}
              initialSuccessful={assistant ? assistantDemoSuccess : dictationDemoSuccess}
              firstMessage={t(
                assistant
                  ? "onboarding.rehaul.assistantDemo.email.body"
                  : "onboarding.rehaul.dictationDemo.founder"
              )}
              secondMessage={t(
                assistant
                  ? `onboarding.rehaul.assistantDemo.scenarios.${scenario}.prompt`
                  : "onboarding.rehaul.dictationDemo.prompt"
              )}
              placeholder={t("onboarding.rehaul.dictationDemo.placeholder")}
              listeningLabel={t("onboarding.rehaul.demo.listening")}
              processingLabel={t("onboarding.rehaul.demo.processing")}
              stopLabel={t("onboarding.rehaul.demo.stop")}
              retryLabel={t("common.retry")}
              onSuccessChange={assistant ? setAssistantDemoSuccess : setDictationDemoSuccess}
            />
          </div>
        );
      }

      case "setup-choice":
        return (
          <div className="h-full w-full pt-2">
            <OnboardingStepHeader
              title={t("onboarding.rehaul.setupChoice.title")}
              titleLines={[
                t("onboarding.rehaul.setupChoice.titleLineOne"),
                t("onboarding.rehaul.setupChoice.titleLineTwo"),
              ]}
              description={t("onboarding.rehaul.setupChoice.description")}
            />
            <SetupChoiceStep
              agentAllowed={agentAllowed}
              localSpaceGb={localSpaceGb}
              onSelect={handleSetupSelection}
            />
          </div>
        );

      case "byok-dictation":
      case "byok-assistant":
        return (
          <div className="h-full w-full pt-2">
            <div>
              <OnboardingStepHeader
                title={t("onboarding.rehaul.setupChoice.moreOptions.selfHosted.title")}
                description={t("onboarding.rehaul.setupChoice.moreOptions.selfHosted.description")}
                wideTitle
              />
            </div>
            <SelfHostedProviderStep
              key={currentStepId}
              stepId={currentStepId}
              onProceed={() => void continueFromCurrentStep()}
              resumeState={session.resume.byok[currentStepId]}
              onResumeStateChange={updateCurrentByokDraft}
            />
          </div>
        );

      case "local-setup":
        return (
          <div className="h-full w-full pt-2">
            <OnboardingStepHeader
              title={t("onboarding.rehaul.localSetup.title")}
              wideTitle
              description={
                localSetupPlan ? (
                  t(
                    localSetupPlan.organizationRunsText
                      ? "onboarding.rehaul.localSetup.subtitleOrganizationText"
                      : "onboarding.rehaul.localSetup.subtitle",
                    {
                      computer: localSetupComputerName(localSetupPlan.profile, t),
                      language: localSetupLanguageLabel(localSetupPlan.languageTags, i18n.language),
                    }
                  )
                ) : (
                  <LocalSetupSubtitlePlaceholder />
                )
              }
            />
            {/* The computer and policy reads finish long before anyone gets
                here; until they do, the card's frame holds its place. A policy
                that couldn't be read says so (it is read again on focus). */}
            {localSetupPlan ? (
              <LocalSetupStep
                plan={localSetupPlan}
                onProceed={(handOff) => void proceedLocalSetup(handOff)}
              />
            ) : (
              <LocalSetupStepPlaceholder
                message={policy.status === "error" ? t("common.policyUnresolved") : undefined}
              />
            )}
          </div>
        );
    }
  };

  const hasShellNavigation = !compact;
  const hotkeyStep = currentStepId === "dictation-hotkey" || currentStepId === "assistant-hotkey";
  const demoStep = currentStepId === "dictation-demo" || currentStepId === "assistant-demo";
  const inlineProviderStep =
    currentStepId === "setup-choice" ||
    currentStepId === "byok-dictation" ||
    currentStepId === "byok-assistant" ||
    currentStepId === "local-setup";
  const showsContinue =
    hasShellNavigation && !inlineProviderStep && (!(hotkeyStep || demoStep) || canContinue);
  const showsSkip = demoStep && !canContinue;

  return (
    <>
      <OnboardingShell
        compact={compact}
        stepKey={currentStepId}
        onBack={hasShellNavigation && session.history.length > 0 ? goBack : undefined}
        // Back while Proceed finishes would leave a step that has already been
        // committed (local setup's downloads cancel as it unmounts).
        backDisabled={isFinishing}
        onContinue={showsContinue ? () => void continueFromCurrentStep() : undefined}
        onSkip={showsSkip ? () => void continueFromCurrentStep() : undefined}
        continueLabel={
          currentStepId === "use-cases"
            ? t("onboarding.useCase.proceedToSetup")
            : t("common.continue")
        }
        skipLabel={t("common.skip")}
        continueDisabled={!canContinue}
        continueLoading={isFinishing || isRegistering}
        progress={getOnboardingProgress(currentStepId, route)}
        // Label Back only when it is the sole footer action. Unlike the source
        // commit, this branch also has demo Skip, so Back stays icon-only there.
        showBackLabel={!showsContinue && !showsSkip}
      >
        {renderStep()}
      </OnboardingShell>

      <AlertDialog
        open={permissionAlert !== null}
        onOpenChange={(open) => !open && setPermissionAlert(null)}
        title={permissionAlert?.title ?? ""}
        description={permissionAlert?.description}
        onOk={() => setPermissionAlert(null)}
      />
    </>
  );
}
