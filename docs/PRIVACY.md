# Privacy and local data

WhisprLocal stores application data in its own profile, normally `~/.config/whisprlocal`. The compatible OpenWhispr model cache is intentionally reused to avoid duplicate multi-gigabyte downloads. Neither the profile nor model files are part of the source repository or release artifacts.

The local edition removes the account client, official API transport, synchronization implementation, analytics uploader and service-specific IPC handlers. The privacy screen retains local data controls and has no telemetry or diagnostic-upload switch. Local usage statistics are preserved.

The main process installs a destination policy before creating windows or engines. Electron session requests and Node HTTP/HTTPS and fetch calls allow loopback, known GitHub/Hugging Face download hosts, and origins explicitly saved through the self-hosted configuration. Official OpenWhispr web domains are denied even if entered manually. Node fetch refuses automatic redirects; Electron and HTTP download redirects are checked on each request. The updater feed is this repository only.

This is an application boundary, not an operating-system firewall or a security sandbox for arbitrary plugins, modified engines or hostile local processes. The bundled speech/LLM engines serve loopback requests. Verification must cover their network activity as well as the application and renderer processes. Browser links opened deliberately by the user run in the user's external browser.

The local CLI bridge binds to 127.0.0.1 and authenticates requests with a random technical token held in a mode-0600 file under `~/.whisprlocal`. CLI/MCP clients inherit your local access and can modify data. Their output may contain private notes; do not send it to public logs.

Migration first makes a private full backup. The imported profile excludes cookies, account sessions, cloud credentials and synchronization identities. Private backups are retained only on the user's machine. Original data is not deleted. Encrypted self-hosted credentials may require re-entry.

Downloads, GitHub update checks and self-hosted inference require network access. Downloaded local inference does not. Disable automatic updates and disconnect the network if you need a completely offline session.
