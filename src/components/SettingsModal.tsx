import { useMemo, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Brain, Keyboard, Mic, Shield, Sliders, SquareSparkle, Wrench } from "./icons";
import SidebarModal from "./ui/SidebarModal";
import SettingsPage from "./SettingsPage";
import { LEGACY_SUB_TAB, SECTION_ALIASES, type SettingsSectionType } from "../lib/settingsNav";

export type { SettingsSectionType };

const SECTIONS = [
  { id: "general", icon: Sliders, group: "app" },
  { id: "hotkeys", icon: Keyboard, group: "app" },
  { id: "toneStyle", icon: SquareSparkle, group: "app" },
  { id: "speechToText", icon: Mic, group: "aiModels" },
  { id: "llms", icon: Brain, group: "aiModels" },
  { id: "privacyData", icon: Shield, group: "system" },
  { id: "system", icon: Wrench, group: "system" },
] satisfies {
  id: SettingsSectionType;
  icon: ComponentType<{ className?: string }>;
  group: string;
}[];

function resolveSection(requested: string | undefined): SettingsSectionType {
  const section = requested ? (SECTION_ALIASES[requested] ?? requested) : "general";
  return SECTIONS.find((item) => item.id === section)?.id ?? "general";
}

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: string;
}

export default function SettingsModal({ open, onOpenChange, initialSection }: SettingsModalProps) {
  const { t } = useTranslation();
  const sidebarItems = useMemo(
    () =>
      SECTIONS.map(({ id, icon, group }) => ({
        id,
        icon,
        label: t(`settingsModal.sections.${id}.label`),
        description: t(`settingsModal.sections.${id}.description`),
        group: t(`settingsModal.groups.${group}`),
      })),
    [t]
  );
  const [activeSection, setActiveSection] = useState<SettingsSectionType>(() =>
    resolveSection(initialSection)
  );
  const [initialSubTab, setInitialSubTab] = useState(() =>
    initialSection ? LEGACY_SUB_TAB[initialSection] : undefined
  );
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open && initialSection) {
      setActiveSection(resolveSection(initialSection));
      setInitialSubTab(LEGACY_SUB_TAB[initialSection]);
    } else if (!open) {
      setInitialSubTab(undefined);
    }
  }

  const handleSectionChange = (section: SettingsSectionType, subTab?: string) => {
    setActiveSection(resolveSection(section));
    setInitialSubTab(subTab);
  };

  return (
    <SidebarModal<SettingsSectionType>
      open={open}
      onOpenChange={onOpenChange}
      title={t("settingsModal.title")}
      sidebarItems={sidebarItems}
      activeSection={activeSection}
      onSectionChange={handleSectionChange}
    >
      <SettingsPage
        activeSection={activeSection}
        onNavigateToSection={handleSectionChange}
        initialSubTab={initialSubTab}
      />
    </SidebarModal>
  );
}
