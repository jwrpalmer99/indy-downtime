# Indy Downtime Tracker

Indy Downtime Tracker is a Foundry VTT v13 module that models downtime projects as multi-phase progress trackers. Each tracker gets its own character sheet tab with progress, check selection, and roll controls.

## Highlights
- Multiple trackers per world, each with its own sheet tab and state.
- Phase-based structure with auto-advance when a phase completes.
- Phase Flow editor to add groups and checks, set DCs, and manage dependencies.
- Dependency effects: block, harder (DC penalty), advantage, disadvantage, and override skill/DC.
- Group max successes to cap progress in a group.
- Success and failure narrative lines tied to checks, groups, or left unassigned as fallbacks.
- Player permissions: hide DCs, hide locked checks, allow Phase Plan view, show/hide relationships and lines in the plan.
- Per-tracker labels and icon: header, tab label, interval label, Font Awesome icon.
- Restrict tracker visibility to specific actor UUIDs.
- Roll summaries in chat, activity log, and manual progress editing.
- Import/export for a tracker, a phase, all settings, or all state.
- Compatible with default DnD5e sheets, Tidy5e, and PF2e character sheets.

## Quick Start
1. Enable the module.
2. Open Game Settings -> Module Settings -> Indy Downtime Tracker: Configure Tracker.
3. Add a tracker and set labels/icons as needed.
4. Open Edit Phase Configuration and set phase names and targets.
5. Use Edit Flow to add groups, checks, and dependencies.
6. Open a character sheet and use the tracker tab to roll checks.

## UI At A Glance
- Configure Tracker: main settings and maintenance actions.
- Edit Phase Configuration: phase names, targets, critical bonus, failure events, images, and completion actions.
- Edit Flow: groups, checks, dependencies, and narrative lines.
- Edit Progress State: manual progress, check count, and completion flags.
- Export/Import Settings: all tracker configuration.
- Export/Import State: all tracker state and progress.

## Compatibility
- Foundry VTT v13
- DnD5e system (primary)
- PF2e character sheets (tab injection + roll support)
- Tidy5e character sheet

See settings.md for a full settings walkthrough and tutorial.md for a step-by-step example.