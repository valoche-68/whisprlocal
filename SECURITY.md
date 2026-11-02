# Security

Report suspected vulnerabilities through the repository's GitHub Security Advisories when available. For a public issue, describe the problem without including private data, tokens, profiles or exploitable credentials.

The application is intended for a trusted local desktop. Its loopback API token is a local technical credential, not a cloud-provider key. Do not expose the bridge through a reverse proxy or share its token file.

Supported release artifacts are Linux x86_64 builds published from this repository. Review SHA256SUMS. No automatic upstream merge or public release is performed.
