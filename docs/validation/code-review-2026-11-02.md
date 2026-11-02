# Local edition code review — 2026-11-02

This review examined the independent edition's application wiring, local API/MCP, network policy, migration, speech-model lifecycle, credentials and update automation. It is not a claim that every inherited upstream feature or dependency is defect-free.

## Corrected

- Restored the missing **Tone and style** settings route using the original upstream component. The menu entry previously opened an empty page.
- Restored the five credential bridges and encrypted storage entries used by explicitly configured self-hosted language-model endpoints. Cloud-provider keys remain excluded.
- MCP re-reads the local bridge token after desktop restarts and handles invalid JSON-RPC messages without terminating its session.
- Official-domain blocking handles DNS names with a trailing dot.
- Upstream merge preparation supplies its own Git identity on a clean CI runner.
- Managed archive installations retain their own update backend even when a Debian installation also exists.
- Migration preserves private spaces, moves imported team content locally, and resolves same-name folder collisions before removing account identifiers. Note/folder IDs and relationships remain intact.
- Bulk Whisper deletion stops an idle engine before unlinking its loaded model and refuses deletion while transcription or download is active.

The Debian uninstaller's existing model-removal behavior is deliberately retained at the user's explicit request. A migration must preserve shared model files before uninstalling the old package.

## Validation

TypeScript and renderer compilation pass. The regression run passes 589 selected upstream tests and 17 local tests with no failures or skips. The subsequently added bulk-deletion regression also passes together with the two individual-deletion tests. Tests use temporary fixtures, including real folder uniqueness/foreign-key constraints, a rotating local bridge token and an unconfigured Git identity.

## Update recovery follow-up

A crash or reset after preparing a managed archive can leave its version directory on disk while losing the in-memory staged-update state. Downloading that version again then reports **Version already staged**. Recovery should persist verified staging metadata or rebuild the staged version safely without trusting or deleting the current/previous installation. The retry now extracts the freshly verified archive into a new versioned directory when the canonical version directory already exists. It never trusts or overwrites that older directory, which may be the running or rollback installation. A focused Electron-hosted regression passes. This follow-up is committed for the next build; it is not yet deployed in the installed app. Old staged directories remain available rather than being deleted automatically.

The first public AppImage update cycle and administrator Debian installation still need delivery-path smoke tests after human approval. No public release or upstream merge is approved by this review.

## Français

La revue a corrigé la page vide « Ton et style », les jetons auto-hébergés par usage, la reconnexion MCP, les messages MCP invalides, le contrôle des domaines officiels, la préparation Git des migrations amont, le choix du mécanisme de mise à jour, la migration des dossiers et la suppression globale de Whisper.

Le comportement de suppression des modèles lors de la désinstallation est conservé conformément à la demande de l'utilisateur. Le correctif de reprise après arrêt brutal est préparé et testé pour la prochaine compilation. La revue et les tests ne constituent pas une garantie d'absence de défaut dans l'ensemble du code hérité.
