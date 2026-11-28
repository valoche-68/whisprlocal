import React, { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import App from "./App.jsx";
import MeetingNotificationOverlay from "./components/MeetingNotificationOverlay.tsx";
import { PermissionGuideOverlay } from "./components/onboarding/PermissionGuideOverlay";
import BackgroundModelDownloadTray from "./components/onboarding/BackgroundModelDownloadTray.tsx";
import { useControlPanelWindowDrag } from "./hooks/useControlPanelWindowDrag";
import { useTheme } from "./hooks/useTheme";
import { usePolicyStore } from "./stores/policyStore";
import { useSettingsStore } from "./stores/settingsStore";
import { isAgentWindow, isControlPanelWindow } from "./utils/windowContext.ts";

const ControlPanel = React.lazy(() => import("./components/ControlPanel.tsx"));
const OnboardingFlow = React.lazy(() => import("./components/OnboardingFlow.tsx"));
const AgentWindow = React.lazy(() => import("./components/agent/AgentWindow.tsx"));
const ONBOARDING_COMPLETED_KEY = "onboardingCompleted";

function hasCompletedOnboarding() {
  return localStorage.getItem(ONBOARDING_COMPLETED_KEY) === "true";
}

export default function AppRouter() {
  useTheme();
  useEffect(() => {
    void usePolicyStore.getState().bootstrap();
  }, []);

  const params = new URLSearchParams(window.location.search);
  if (params.get("permission-guide") === "true") return <PermissionGuideOverlay />;
  if (params.get("meeting-notification") === "true") return <MeetingNotificationOverlay />;

  // The assistant must not report onboarding state as if it were the control panel.
  if (isAgentWindow()) {
    return (
      <Suspense fallback={null}>
        <AgentWindow />
      </Suspense>
    );
  }

  return <MainApp />;
}

function MainApp() {
  const isControlPanel = isControlPanelWindow();
  const [onboardingCompleted, setOnboardingCompleted] = useState(hasCompletedOnboarding);
  const [initialSettingsSection, setInitialSettingsSection] = useState(undefined);
  useControlPanelWindowDrag(isControlPanel);

  useEffect(() => {
    const { noteFilesEnabled, noteFilesPath } = useSettingsStore.getState();
    void window.electronAPI?.noteFilesSetEnabled?.(noteFilesEnabled, noteFilesPath || undefined, {
      startup: true,
    });
  }, []);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === ONBOARDING_COMPLETED_KEY) setOnboardingCompleted(hasCompletedOnboarding());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    void window.electronAPI?.setOnboardingActive?.(!onboardingCompleted);
    if (isControlPanel && onboardingCompleted) {
      void window.electronAPI?.setOnboardingWindowMode?.("restore");
    }
    if (!isControlPanel && !onboardingCompleted) void window.electronAPI?.hideWindow?.();
  }, [isControlPanel, onboardingCompleted]);

  const handleOnboardingComplete = (options) => {
    if (options?.openSettings) setInitialSettingsSection("transcription");
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
    setOnboardingCompleted(true);
  };

  if (!isControlPanel) return <App />;

  return (
    <Suspense fallback={<LoadingFallback />}>
      {onboardingCompleted ? (
        <ControlPanel initialSettingsSection={initialSettingsSection} />
      ) : (
        <OnboardingFlow onComplete={handleOnboardingComplete} />
      )}
      <BackgroundModelDownloadTray placement={onboardingCompleted ? undefined : "onboarding"} />
    </Suspense>
  );
}

function LoadingFallback() {
  const { t } = useTranslation();
  const fallbackMessage = t("common.loading");

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 animate-[scale-in_300ms_ease-out]">
        <svg
          viewBox="0 0 1024 1024"
          className="w-12 h-12 drop-shadow-[0_2px_8px_rgba(37,99,235,0.18)] dark:drop-shadow-[0_2px_12px_rgba(100,149,237,0.25)]"
          aria-label="WhisprLocal"
        >
          <rect width="1024" height="1024" rx="241" fill="#2056DF" />
          <circle cx="512" cy="512" r="314" fill="#2056DF" stroke="white" strokeWidth="74" />
          <path d="M512 383V641" stroke="white" strokeWidth="74" strokeLinecap="round" />
          <path d="M627 457V568" stroke="white" strokeWidth="74" strokeLinecap="round" />
          <path d="M397 457V568" stroke="white" strokeWidth="74" strokeLinecap="round" />
        </svg>
        <div className="w-7 h-7 rounded-full border-[2.5px] border-transparent border-t-primary animate-[spinner-rotate_0.8s_cubic-bezier(0.4,0,0.2,1)_infinite] motion-reduce:animate-none motion-reduce:border-t-muted-foreground motion-reduce:opacity-50" />
        {fallbackMessage && (
          <p className="text-[13px] font-medium text-muted-foreground dark:text-foreground/60 tracking-[-0.01em]">
            {fallbackMessage}
          </p>
        )}
      </div>
    </div>
  );
}
