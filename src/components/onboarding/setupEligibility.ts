import {
  filterLocalModelOptionsByPolicy,
  isModeAllowedByPolicy,
  isProviderAllowedByPolicy,
  type PolicyDecisionSnapshot,
} from "../../stores/policyRules.ts";

interface ProviderOption {
  id: string;
}

export interface OnboardingSetupAvailability {
  local: boolean;
  selfHosted: boolean;
}

/**
 * A setup card is available only when every stage behind it has at least one
 * usable option. Checking modes alone can expose a route whose provider list is
 * empty after workspace-policy filtering.
 */
export function getOnboardingSetupAvailability({
  policy,
  agentAllowed,
  supportedLocalTranscriptionModels,
}: {
  policy: PolicyDecisionSnapshot;
  agentAllowed: boolean;
  supportedLocalTranscriptionModels: ProviderOption[];
}): OnboardingSetupAvailability {
  // Only speech decides: the local assistant step is optional, and when AI text
  // is blocked it says so and offers Skip.
  const local =
    filterLocalModelOptionsByPolicy(supportedLocalTranscriptionModels, "transcription", policy)
      .length > 0;
  const selfHosted =
    isModeAllowedByPolicy(policy, "transcription", "self-hosted") &&
    isProviderAllowedByPolicy(policy, "transcription", "custom") &&
    (!agentAllowed ||
      (isModeAllowedByPolicy(policy, "llm", "self-hosted") &&
        isProviderAllowedByPolicy(policy, "llm", "custom")));

  return { local, selfHosted };
}

export function hasAvailableOnboardingSetup(availability: OnboardingSetupAvailability): boolean {
  return Object.values(availability).some(Boolean);
}
