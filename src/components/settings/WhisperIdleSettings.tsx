import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Toggle } from "../ui/toggle";
import { useSettingsStore } from "../../stores/settingsStore";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export default function WhisperIdleSettings() {
  const { t } = useTranslation();
  const id = useId();
  const helpId = `${id}-help`;
  const enabled = useSettingsStore((s) => s.whisperIdleUnloadEnabled);
  const setEnabled = useSettingsStore((s) => s.setWhisperIdleUnloadEnabled);
  const seconds = useSettingsStore((s) => s.whisperIdleTimeoutSeconds);
  const setSeconds = useSettingsStore((s) => s.setWhisperIdleTimeoutSeconds);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h4 className="text-sm font-medium">{t("whisperIdle.enabledLabel")}</h4>
          <p className="text-xs text-muted-foreground">{t("whisperIdle.enabledHelp")}</p>
        </div>
        <Toggle checked={enabled} onChange={setEnabled} ariaLabel={t("whisperIdle.enabledLabel")} />
      </div>
      <label htmlFor={id} className="text-sm font-medium">
        {t("whisperIdle.label")}
      </label>
      <Select
        disabled={!enabled}
        value={String(seconds)}
        onValueChange={(value) => setSeconds(Number(value))}
      >
        <SelectTrigger id={id} aria-describedby={helpId} className="w-full sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[5, 10, 30, 60, 300].map((value) => (
            <SelectItem key={value} value={String(value)}>
              {t("whisperIdle.seconds", { count: value })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={helpId} className="text-xs text-muted-foreground">
        {t(enabled ? "whisperIdle.help" : "whisperIdle.disabledHelp")}
      </p>
    </div>
  );
}
