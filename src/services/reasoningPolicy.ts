import i18n from "../i18n";
import { modelRegistry } from "../models/ModelRegistry";
import {
  isAgentAllowed,
  isLlmSelectionAllowed,
  isLocalChoiceRefusal,
  localModelRefusal,
} from "../stores/policyRules";
import { usePolicyStore } from "../stores/policyStore";
import type { InferenceMode } from "../types/electron";

export function assertReasoningAllowedByPolicy(
  provider: string,
  mode: InferenceMode,
  model?: string
): void {
  const local = mode === "local" && (provider === "local" || !!modelRegistry.getProvider(provider));
  // The SDK uses its local OpenAI-compatible adapter for explicit self-hosted targets.
  const selfHosted = mode === "self-hosted" && (provider === "lan" || provider === "local");
  if (!local && !selfHosted) {
    throw Object.assign(new Error(i18n.t("common.policyAiProcessingRestricted")), {
      code: "LOCAL_ONLY",
    });
  }
  const state = usePolicyStore.getState();
  if (isLlmSelectionAllowed(state, { mode, provider, model })) return;
  if (mode === "local") {
    const { code, messageKey, settingsTarget } = localModelRefusal(state, "llm");
    throw Object.assign(new Error(i18n.t(messageKey)), {
      code,
      messageKey,
      ...(isLocalChoiceRefusal(code) ? { settingsTarget } : {}),
    });
  }
  throw Object.assign(new Error(i18n.t("common.policyAiProcessingRestricted")), {
    code: "POLICY_RESTRICTED",
  });
}

export function assertAgentAllowedByPolicy(): void {
  if (!isAgentAllowed(usePolicyStore.getState())) {
    throw new Error(i18n.t("common.policyAgentRestricted"));
  }
}

/**
 * The check for work already running, which ends only on a settled denial, as
 * main's does: a verdict still loading says nothing new about it, while a
 * settled error (an unreadable device policy, a policy the server called
 * unresolvable, a sign-in the device requires) is a denial.
 */
export function runningPolicyCheck(assertAllowed: () => void): () => void {
  return () => {
    if (usePolicyStore.getState().status !== "loading") assertAllowed();
  };
}

export function onPolicyRestriction(assertAllowed: () => void, stop: (error: unknown) => void) {
  return usePolicyStore.subscribe(() => {
    try {
      assertAllowed();
    } catch (error) {
      stop(error);
    }
  });
}
