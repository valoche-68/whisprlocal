import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CopyableCommand } from "../ui/CopyableCommand";
import { SectionLabel, SettingsPanel, SettingsPanelRow } from "../ui/SettingsSection";
import { IntegrationsPane } from "./IntegrationsPane";

const CLI_DOCS_URL = "https://github.com/valoche-68/whisprlocal#cli-api-and-mcp";
const INSTALL_CMD = "whisprlocal --cli --help";
const LOCAL_EXAMPLE = "whisprlocal --cli notes list";

interface CliPaneProps {
  title: string;
  command?: string;
}

export function CliPane({ title, command = "whisprlocal" }: CliPaneProps): ReactElement {
  const { t } = useTranslation();
  const executable = "'" + command.replaceAll("'", "'\\''") + "'";

  return (
    <IntegrationsPane
      title={title}
      description={t("integrations.cli.description")}
      docsUrl={CLI_DOCS_URL}
    >
      <div>
        <SectionLabel>{t("integrations.cli.installLabel")}</SectionLabel>
        <CopyableCommand command={`${executable} --cli --help`} />
      </div>

      <div className="grid gap-3">
        <SettingsPanel>
          <SettingsPanelRow className="space-y-2.5">
            <div>
              <div className="flex h-[18px] items-center gap-1.5">
                <h3 className="text-xs font-semibold text-foreground">
                  {t("integrations.cli.local.label")}
                </h3>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                  {t("integrations.cli.local.freeBadge")}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground/70 mt-0.5 leading-relaxed">
                {t("integrations.cli.local.description")}
              </p>
            </div>
            <CopyableCommand command={`${executable} --cli notes list`} />
          </SettingsPanelRow>
        </SettingsPanel>

        
      </div>
    </IntegrationsPane>
  );
}
