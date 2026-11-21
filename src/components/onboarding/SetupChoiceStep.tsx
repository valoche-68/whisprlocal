import { useRegistryVersion } from "../../hooks/useRegistryVersion";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  BanknoteCheck,
  GalleryVerticalEnd,
  Laptop,
  Server,
  WifiOff,
  Zap,
} from "../icons";
import { useTranslation } from "react-i18next";
import { usePolicySnapshot } from "../../hooks/usePolicy";
import { getParakeetModels, getWhisperModels } from "../../models/ModelRegistry";
import type { OnboardingSetupMode } from "./flow";
import { getOnboardingSetupAvailability, hasAvailableOnboardingSetup } from "./setupEligibility";
import { LocalModelPolicyNotice } from "../ui/LocalModelPolicyNotice";
import { LOCAL_ASR_ORGANIZATIONS } from "../../helpers/localASROrganization";
import { getProviderIcon, isMonochromeProvider } from "@/utils/providerIcons";
import { cn } from "../lib/utils";

type SetupMode = Exclude<OnboardingSetupMode, null | "cloud">;

// What the Local card quotes until OnboardingFlow has worked out the local setup.
const DEFAULT_LOCAL_SPACE_GB = 2;

interface SetupChoiceStepProps {
  agentAllowed: boolean;
  /**
   * Free space the local setup needs at least, in whole GB: dictation alone (the
   * optional rows turn off to fit), with the room its download reserves to unpack.
   */
  localSpaceGb?: number;
  onSelect: (mode: SetupMode) => void;
}

function Feature({ icon: Icon, children }: { icon: typeof Zap; children: string }) {
  return (
    <li className="flex items-center gap-1.5 text-xs leading-[1.4] text-[var(--onboarding-text-primary)]">
      <Icon className="size-3 shrink-0 text-[var(--onboarding-text-tertiary)]" />
      {children}
    </li>
  );
}

// Compact setup card: content stays pinned to the top and the action to the bottom.
function SetupCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative flex h-[350px] w-68 shrink-0 flex-col justify-between overflow-hidden rounded-2xl border border-[var(--onboarding-control-border)] bg-[var(--onboarding-surface)] px-4 pb-5 pt-4 text-start">
      {children}
    </section>
  );
}

// Figma "Frame 25": pad 8 20, radius 38, 14/140% medium. Brand fill or stroke.
function CardAction({
  brand = false,
  onClick,
  children,
}: {
  brand?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`onboarding-pressable relative z-10 w-full rounded-[38px] px-4 py-1.5 text-xs font-medium leading-[1.4] ${
        brand
          ? "bg-[var(--onboarding-accent)] text-[var(--onboarding-accent-foreground)] hover:brightness-95"
          : "border border-[var(--onboarding-control-border)] text-[var(--onboarding-text-primary)] hover:bg-[var(--onboarding-surface-hover)]"
      }`}
    >
      {children}
    </button>
  );
}

export default function SetupChoiceStep({
  agentAllowed,
  localSpaceGb = DEFAULT_LOCAL_SPACE_GB,
  onSelect,
}: SetupChoiceStepProps) {
  useRegistryVersion();
  const { t } = useTranslation();
  const policy = usePolicySnapshot();
  // Unknown counts as supported, or a Parakeet-only policy would flash "unavailable"
  // on every device while the check runs.
  const [parakeetUnsupported, setParakeetUnsupported] = useState(false);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      ?.checkParakeetInstallation?.()
      .then((capability) => {
        if (!cancelled) setParakeetUnsupported(capability.supported === false);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const availability = getOnboardingSetupAvailability({
    policy,
    agentAllowed,
    supportedLocalTranscriptionModels: [
      ...Object.keys(getWhisperModels()),
      ...(parakeetUnsupported ? [] : Object.keys(getParakeetModels())),
    ].map((id) => ({ id })),
  });
  const { local: localAllowed, selfHosted: selfHostedAllowed } = availability;
  if (!hasAvailableOnboardingSetup(availability)) {
    return (
      <div
        role="alert"
        className="mx-auto mt-8 flex w-full max-w-md flex-col items-center rounded-2xl border border-[var(--onboarding-control-border)] bg-[var(--onboarding-surface)] px-6 py-8 text-center"
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-[var(--onboarding-surface-secondary)] text-[var(--onboarding-accent)]">
          <AlertCircle className="size-5" />
        </span>
        <h2 className="mt-4 text-base font-semibold text-[var(--onboarding-text-primary)]">
          {t("onboarding.rehaul.setupChoice.unavailable.title")}
        </h2>
        <p className="mt-2 text-sm leading-5 text-[var(--onboarding-text-secondary)]">
          {t("onboarding.rehaul.setupChoice.unavailable.description")}
        </p>
        <LocalModelPolicyNotice scope="transcription" hasSupportedModel={false} />
      </div>
    );
  }

  return (
    // Figma "Frame 2147259042": column, gap 32, centred — the card row above the
    // Show More Options pill.
    <div className="mx-auto mt-5 flex w-full flex-col items-center gap-4">
      {!localAllowed && <LocalModelPolicyNotice scope="transcription" hasSupportedModel={false} />}
      {/* Frame 60: row, gap 16. */}
      <div className="onboarding-stagger flex items-start justify-center gap-3">
        {localAllowed && (
          <SetupCard>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                {/* Frame 2147259034: the local model marks overlap by 8, each on a
                    1.33px surface ring so the stack reads front-to-back. NVIDIA's
                    tile is its own green field, so it fills the chip and is clipped
                    to the circle; the other marks sit inside it, with OpenAI's
                    inverted onto the dark chip. */}
                <span className="flex -space-x-2">
                  {LOCAL_ASR_ORGANIZATIONS.map(({ id }) => (
                    <span
                      key={id}
                      className="flex size-9 items-center justify-center overflow-hidden rounded-full bg-[var(--onboarding-inverse-surface)] ring-[1.33px] ring-[var(--onboarding-surface)]"
                    >
                      <img
                        src={getProviderIcon(id)}
                        alt=""
                        aria-hidden="true"
                        decoding="async"
                        draggable={false}
                        className={cn(
                          id === "nvidia" ? "size-full object-cover" : "size-4",
                          isMonochromeProvider(id) && "invert dark:invert-0"
                        )}
                      />
                    </span>
                  ))}
                </span>
                {/* Frame 49: pad 4 9, radius 47, surface-tertiary, 10/140%. */}
                <span className="rounded-[47px] bg-[var(--onboarding-surface-tertiary)] px-[9px] py-1 text-[10px] leading-[1.4] text-[var(--onboarding-text-primary)]">
                  {t("onboarding.rehaul.setupChoice.local.badge")}
                </span>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <h2 className="onboarding-card-title text-[var(--onboarding-text-primary)]">
                    {t("onboarding.rehaul.setupChoice.local.title")}
                  </h2>
                  <p className="text-sm leading-[1.4] text-[var(--onboarding-text-secondary)]">
                    {t("onboarding.rehaul.setupChoice.local.description", {
                      minimumSpace: localSpaceGb,
                    })}
                  </p>
                </div>
                {/* The four marks are the icon-set equivalents of the glyphs the
                    Figma assets were exported from. */}
                <ul className="flex flex-col gap-2">
                  <Feature icon={Laptop}>
                    {t("onboarding.rehaul.setupChoice.local.features.device")}
                  </Feature>
                  <Feature icon={WifiOff}>
                    {t("onboarding.rehaul.setupChoice.local.features.offline")}
                  </Feature>
                  <Feature icon={GalleryVerticalEnd}>
                    {t("onboarding.rehaul.setupChoice.local.features.setup")}
                  </Feature>
                  <Feature icon={BanknoteCheck}>
                    {t("onboarding.rehaul.setupChoice.local.features.free")}
                  </Feature>
                </ul>
              </div>
            </div>
            {/* Straight to the local setup step: it shows what will download and how
                big it is before anything starts. */}
            <CardAction onClick={() => onSelect("local")}>
              {t("onboarding.rehaul.setupChoice.local.download")}
            </CardAction>
          </SetupCard>
        )}
      </div>

      {selfHostedAllowed && (
        <button
          type="button"
          onClick={() => onSelect("byok")}
          className="onboarding-pressable inline-flex items-center gap-2 rounded-[38px] border border-[var(--onboarding-control-border)] px-4 py-1.5 text-xs font-medium leading-[1.4] text-[var(--onboarding-text-primary)] hover:bg-[var(--onboarding-surface-hover)]"
        >
          <Server className="size-3.5" aria-hidden="true" />
          {t("onboarding.rehaul.setupChoice.moreOptions.selfHosted.title")}
        </button>
      )}
    </div>
  );
}
