# Local Whisper Setup

OpenWhispr supports local speech-to-text processing using whisper.cpp. This keeps your audio completely private—nothing leaves your device.

## Quick Start

1. Open the **Control Panel** (right-click tray icon or click the overlay)
2. Go to **Settings** → **Speech to Text Processing**
3. Enable **Use Local Whisper**
4. Select a model (recommended: `base`)
5. Click **Save**

The first transcription will download the model automatically.

## Model Selection

| Model  | Size  | Speed   | Quality | RAM   | Best For         |
| ------ | ----- | ------- | ------- | ----- | ---------------- |
| tiny   | 75MB  | Fastest | Basic   | ~1GB  | Quick notes      |
| base   | 142MB | Fast    | Good    | ~1GB  | **Recommended**  |
| small  | 466MB | Medium  | Better  | ~2GB  | Professional use |
| medium | 1.5GB | Slow    | High    | ~5GB  | High accuracy    |
| large  | 3GB   | Slowest | Best    | ~10GB | Maximum quality  |
| turbo  | 1.6GB | Fast    | High    | ~6GB  | Fast + accurate  |

## GPU Acceleration

Local Whisper can run on your GPU for much faster transcription:

- **macOS**: Metal acceleration is built in — no setup needed on Apple Silicon
- **NVIDIA (Windows/Linux)**: CUDA acceleration; Linux requires a current compatible NVIDIA driver, but not the CUDA Toolkit
- **AMD / Intel (Windows/Linux)**: Vulkan acceleration for Radeon, Arc, and integrated GPUs
- **NVIDIA alternative**: Vulkan is also supported and is used automatically when its runtime is installed and CUDA fails

GPU runtimes are downloaded on demand with SHA-256-verified checksums. If one fails, OpenWhispr uses the next available backend and finally CPU, so dictation keeps working.

## How It Works

OpenWhispr uses whisper.cpp, a high-performance C++ implementation of OpenAI's Whisper model:

1. whisper.cpp binary is bundled with the app (or uses system installation as fallback)
2. GGML models are downloaded on first use to `~/.cache/openwhispr/whisper-models/`
3. Audio is processed locally using FFmpeg (bundled with the app)

## Requirements

- **Disk Space**: 75MB–3GB depending on model
- **RAM**: 1GB–10GB depending on model
- **GPU driver**: required for GPU acceleration; the CUDA Toolkit is not required

## Running From Source

If you're running OpenWhispr locally from a git checkout (not a packaged app), download the whisper.cpp binary for your current platform:

```bash
npm run download:whisper-cpp
```

This puts the binary in `resources/bin/`. For multi-platform packaging from a single machine, use:

```bash
npm run download:whisper-cpp:all
```

## File Locations

| Data   | macOS                                 | Windows                                           | Linux                                 |
| ------ | ------------------------------------- | ------------------------------------------------- | ------------------------------------- |
| Models | `~/.cache/openwhispr/whisper-models/` | `%USERPROFILE%\.cache\openwhispr\whisper-models\` | `~/.cache/openwhispr/whisper-models/` |

## Troubleshooting

### "Not Found" Status

1. Click **Recheck Installation** in Control Panel
2. Restart the app
3. If bundled binary fails, install via package manager:
   - macOS: `brew install whisper-cpp`
   - Linux: Build from source at https://github.com/ggml-org/whisper.cpp

### Transcription Fails

1. Verify microphone permissions
2. Try a smaller model (tiny/base)
3. Check disk space for model downloads

### Slow Performance

1. Use smaller models (tiny or base)
2. Close resource-intensive apps
3. Consider using cloud mode for large files

## Privacy Comparison

| Mode  | Audio Leaves Device | Internet Required       | Cost      |
| ----- | ------------------- | ----------------------- | --------- |
| Local | No                  | Only for model download | Free      |
| Cloud | Yes (to OpenAI)     | Yes                     | API usage |

## Optional local model residency

Turn on **Keep model loaded** (Settings → Language Models, shown for any
feature set to Local) to keep whichever local language model is loaded in
memory after idle periods. The default remains the five-minute idle unload.

Residency avoids the next model reload but keeps the model's RAM/VRAM allocated
and does not speed up token generation. Explicit shutdown, model changes,
and context growth still release/restart the server normally. This option
leaves the Local inference timeout, context sizing and cleanup controls
unchanged. It also applies when other local-language-model features share the
same server. Turn it off to restore the five-minute idle unload.

## Local Whisper idle unloading (experimental)

The local Whisper server stops after **five seconds after transcription finishes**,
releasing its RAM/VRAM. The next dictation starts the selected model again using
the existing backend, language and VAD configuration. That first dictation may
take longer while the model loads. Models on disk are kept.

Under **Speech to Text → Dictation**, select local Whisper to show **Automatic
unloading**. Switch it on and choose 5, 10, 30, 60 or 300 seconds. Switch it off to
keep Whisper loaded between dictations; the selected delay is remembered when you
turn it on again. The switch and delay are saved, synchronized between windows
and applied immediately, without restarting the application. If the model was
already unloaded, the next dictation reloads it normally.

This setting is shared by local Whisper uses and is independent of the language
model's **Keep model loaded** option. Installing this modified application requires
one full application restart; subsequent preference changes do not.

The countdown starts when the server finishes loading and resets after the last
active transcription completes, fails or is cancelled. Audio conversion and
concurrent transcription requests prevent idle shutdown. A request arriving while
the server is stopping waits before starting a replacement. Remote servers are
unaffected. Changing unrelated settings does not reset the countdown.

`WHISPER_IDLE_TIMEOUT_MS` can override the initial default for standalone backend
tests (0 disables cleanup); the application's saved UI preference takes precedence
once settings synchronize. No new installation is included in this source patch.
