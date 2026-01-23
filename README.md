## Indy Downtime Tracker

Foundry VTT v13 module for DnD5e 5.2.4 that tracks downtime projects.

### Features
- Phase-based tracking with sequential unlocks and auto-advance on completion.
- Trackers can be resricted to certain actors - those actors share progress/checks.
- Multiple trackers, each with its own tab, phases, and progress state.
- Configurable skills, DCs, targets, narratives, and per-phase penalties.
- Per-phase settings for critical bonus, failure events, event roll tables, and images.
- Interval label (e.g., Weekly) is configurable and used across UI + chat.
- Activity log + chat summaries for checks and phase completion.
- Per-tracker tab icons and optional DC hiding for players.
- GM-only settings dialogs (ApplicationV2) with export/import for settings and state.
- Works on default DnD5e sheet and Tidy5e sheet.

### Use
1. Enable the module.
2. Configure phases in `Game Settings` -> `Module Settings` -> `Indy Downtime Tracker Settings` (GM only).
3. Use the Tracker selector to add/remove trackers and rename their tabs.
4. Use the configuration buttons to edit phase config and progress state.
5. Use the export/import menus in module settings for backups or transfers.
6. Open any character sheet and use the tracker tab(s) to roll checks and track progress.

### Settings Dialogs
- Phase Configuration: edit phase rules, skills, DCs, narratives, penalties, roll tables, and images.
- Progress State: adjust progress, completion, failures, and check count.

### Export/Import
- `Export/Import Settings`: exports all configuration to JSON.
- `Export/Import State`: exports the current tracker state to JSON.




