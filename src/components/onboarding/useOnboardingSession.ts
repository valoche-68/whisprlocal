import { useCallback, useEffect, useState } from "react";
import type { PermissionGuideId } from "../../types/permissionGuide";
import {
  LEGACY_ONBOARDING_STEP_KEY,
  ONBOARDING_SESSION_KEY,
  createOnboardingSession,
  migrateLegacyOnboardingStep,
  parseOnboardingSession,
  prepareLocalOnboardingSession,
  type OnboardingSession,
  type OnboardingSetupMode,
  type OnboardingStepId,
} from "./flow";

function readInitialSession(): OnboardingSession {
  const session = createOnboardingSession();
  if (typeof window === "undefined") return prepareLocalOnboardingSession(session);

  const saved = parseOnboardingSession(localStorage.getItem(ONBOARDING_SESSION_KEY));
  if (saved) return prepareLocalOnboardingSession(saved);

  session.currentStepId = migrateLegacyOnboardingStep(
    localStorage.getItem(LEGACY_ONBOARDING_STEP_KEY)
  );
  return prepareLocalOnboardingSession(session);
}

export function useOnboardingSession() {
  const [session, setSession] = useState<OnboardingSession>(readInitialSession);

  useEffect(() => {
    localStorage.setItem(ONBOARDING_SESSION_KEY, JSON.stringify(session));
    // The old key lets pre-session builds recover this step on rollback.
    localStorage.setItem(LEGACY_ONBOARDING_STEP_KEY, session.currentStepId);
  }, [session]);

  const goTo = useCallback((stepId: OnboardingStepId) => {
    setSession((current) => {
      if (current.currentStepId === stepId) return current;
      return {
        ...current,
        currentStepId: stepId,
        history: [...current.history, current.currentStepId],
      };
    });
  }, []);

  const goBack = useCallback(() => {
    setSession((current) => {
      const history = [...current.history];
      const previous = history.pop();
      return previous ? { ...current, currentStepId: previous, history } : current;
    });
  }, []);

  const setSetupMode = useCallback((setupMode: OnboardingSetupMode) => {
    setSession((current) => ({ ...current, setupMode }));
  }, []);

  const setSelfHostedRequested = useCallback((selfHostedRequested: boolean) => {
    setSession((current) => ({ ...current, selfHostedRequested }));
  }, []);

  const setPermissionGuide = useCallback((permissionGuide: PermissionGuideId | null) => {
    setSession((current) => ({ ...current, permissionGuide }));
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(ONBOARDING_SESSION_KEY);
    localStorage.removeItem(LEGACY_ONBOARDING_STEP_KEY);
  }, []);

  return {
    session,
    setSession,
    goTo,
    goBack,
    setSetupMode,
    setSelfHostedRequested,
    setPermissionGuide,
    clearSession,
  };
}
