import { CliPane } from "./integrations/CliPane";
import { useEffect, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { IntegrationsNav } from "./integrations/IntegrationsNav";
import { IntegrationsPane } from "./integrations/IntegrationsPane";
import { SkillsPane } from "./integrations/SkillsPane";
import { CopyableCommand } from "./ui/CopyableCommand";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import {
  INTEGRATIONS_SECTIONS,
  type IntegrationsSection,
} from "./integrations/integrationsSections";
import type { SkillChatStart, SkillOpenRequest } from "../types/skills";
interface Props {
  isPaid: boolean;
  onUpgrade: () => void;
  section: IntegrationsSection;
  onSectionChange: (s: IntegrationsSection) => void;
  onStartSkillChat?: (s: SkillChatStart) => void;
  openSkillRequest?: SkillOpenRequest | null;
  onOpenSkillRequestHandled?: () => void;
}
function CopyBlock({ value }: { value: string }) {
  return <CopyableCommand command={value} />;
}
export default function IntegrationsView(props: Props): ReactElement {
  const { t } = useTranslation();
  const section = INTEGRATIONS_SECTIONS.includes(props.section) ? props.section : "cli";
  const [command, setCommand] = useState("whisprlocal");
  useEffect(() => {
    void (
      window.electronAPI as unknown as {
        getLocalIntegrationInfo?: () => Promise<{ command: string }>;
      }
    )
      ?.getLocalIntegrationInfo?.()
      .then((info) => setCommand(info.command));
  }, []);
  const quoted = "'" + command.replaceAll("'", "'\\''") + "'";
  const meta = Object.fromEntries(INTEGRATIONS_SECTIONS.map((id) => [id, null])) as Record<
    IntegrationsSection,
    null
  >;
  return (
    <div className="@container flex h-full min-h-0">
      <IntegrationsNav
        active={section}
        onSelect={props.onSectionChange}
        meta={meta}
        className="@max-2xl:hidden"
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="px-5 pt-6 pb-2 @2xl:hidden">
          <Select
            value={section}
            onValueChange={(value) => props.onSectionChange(value as IntegrationsSection)}
          >
            <SelectTrigger
              className="h-8 w-full text-xs rounded-lg"
              aria-label={t("integrations.nav.label")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTEGRATIONS_SECTIONS.map((id) => (
                <SelectItem key={id} value={id}>
                  {t(`integrations.nav.sections.${id}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-8 pt-6 pb-6 @max-2xl:px-5">
          <div className="max-w-[760px]">
            {section === "skills" ? (
              <SkillsPane
                title={t("integrations.nav.sections.skills")}
                active
                onStartSkillChat={props.onStartSkillChat}
                openSkillRequest={props.openSkillRequest}
                onOpenSkillRequestHandled={props.onOpenSkillRequestHandled}
              />
            ) : section === "cli" ? (
              <CliPane title={t("whisprlocal.cliTitle")} command={command} />
            ) : (
              <IntegrationsPane
                title={t(`whisprlocal.${section}Title`)}
                description={t(`whisprlocal.${section}Description`)}
              >
                <p className="text-xs text-muted-foreground">{t("whisprlocal.appRequired")}</p>

                {section === "mcp" && (
                  <CopyBlock
                    value={JSON.stringify(
                      { mcpServers: { whisprlocal: { command, args: ["--mcp"] } } },
                      null,
                      2
                    )}
                  />
                )}
                {section === "api" && (
                  <>
                    <p className="text-sm">{t("whisprlocal.apiSecurity")}</p>
                    <CopyBlock
                      value={`${quoted} --cli health\n${quoted} --cli notes search --q exemple\n${quoted} --cli dictionary list\n${quoted} --cli history list`}
                    />
                  </>
                )}
                <p className="text-xs text-muted-foreground">{t("whisprlocal.localOperations")}</p>
              </IntegrationsPane>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
