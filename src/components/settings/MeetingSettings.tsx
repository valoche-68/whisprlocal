import { useRegistryVersion } from "../../hooks/useRegistryVersion";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Cpu } from "../icons";
import { useSettingsStore } from "../../stores/settingsStore";
import { InferenceModeSelector, SettingsRow } from "../ui/SettingsSection";
import { Toggle } from "../ui/toggle";
import TranscriptionModelPicker from "../TranscriptionModelPicker";

export function MeetingSpeakerDetectionRow() {
  const { t } = useTranslation();
  const speakerDiarizationEnabled = useSettingsStore((s) => s.speakerDiarizationEnabled);
  const setSpeakerDiarizationEnabled = useSettingsStore((s) => s.setSpeakerDiarizationEnabled);

  return (
    <SettingsRow
      label={t("settings.meeting.speakerDetection.title")}
      description={t("settings.meeting.speakerDetection.description")}
    >
      <Toggle checked={speakerDiarizationEnabled} onChange={setSpeakerDiarizationEnabled} />
    </SettingsRow>
  );
}

function MeetingEchoCancellationRow() {
  const { t } = useTranslation();
  const meetingAecEnabled = useSettingsStore((s) => s.meetingAecEnabled);
  const setMeetingAecEnabled = useSettingsStore((s) => s.setMeetingAecEnabled);

  return (
    <SettingsRow
      label={t("settingsPage.transcription.aec.toggle.title")}
      description={t("settingsPage.transcription.aec.toggle.description")}
    >
      <Toggle checked={meetingAecEnabled} onChange={setMeetingAecEnabled} />
    </SettingsRow>
  );
}

const noop = () => {};

export function MeetingTranscriptionPanel() {
  useRegistryVersion();
  const { t } = useTranslation();
  const {
    meetingWhisperModel,
    setMeetingWhisperModel,
    meetingLocalTranscriptionProvider,
    setMeetingLocalTranscriptionProvider,
    meetingParakeetModel,
    setMeetingParakeetModel,
    meetingCohereModel,
    setMeetingCohereModel,
  } = useSettingsStore();

  const selectLocalModel = useCallback(
    (modelId: string, providerId = meetingLocalTranscriptionProvider) => {
      if (providerId === "nvidia") setMeetingParakeetModel(modelId);
      else if (providerId === "cohere") setMeetingCohereModel(modelId);
      else setMeetingWhisperModel(modelId);
    },
    [
      meetingLocalTranscriptionProvider,
      setMeetingParakeetModel,
      setMeetingCohereModel,
      setMeetingWhisperModel,
    ]
  );

  return (
    <div className="space-y-3">
      <InferenceModeSelector
        modes={[
          {
            id: "local",
            label: t("settingsPage.transcription.modes.local"),
            description: t("settingsPage.transcription.modes.localDesc"),
            icon: <Cpu className="w-4 h-4" />,
          },
        ]}
        activeMode="local"
        onSelect={noop}
      />
      <TranscriptionModelPicker
        streamingOnly
        transcriptionContext="meeting"
        selectedCloudProvider=""
        onCloudProviderSelect={noop}
        selectedCloudModel=""
        onCloudModelSelect={noop}
        selectedLocalModel={
          meetingLocalTranscriptionProvider === "nvidia"
            ? meetingParakeetModel
            : meetingLocalTranscriptionProvider === "cohere"
              ? meetingCohereModel
              : meetingWhisperModel
        }
        onLocalModelSelect={selectLocalModel}
        selectedLocalProvider={meetingLocalTranscriptionProvider}
        onLocalProviderSelect={setMeetingLocalTranscriptionProvider}
        useLocalWhisper
        onModeChange={noop}
        mode="local"
        variant="settings"
      />
      <MeetingSpeakerDetectionRow />
      <MeetingEchoCancellationRow />
    </div>
  );
}
