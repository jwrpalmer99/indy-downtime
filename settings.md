# Indy Downtime Tracker Settings Guide

This guide covers every menu, dialog, and option in the current UI.

## Module Settings Entries
Open Game Settings -> Module Settings -> Indy Downtime Tracker **as GM**. You will see:
- Configure Tracker (main settings dialog)
- Export/Import Settings (all tracker configuration)
- Export/Import State (all tracker progress and state)
- Debug Logging
- Manual Skill/Ability Overrides (system-agnostic only)
- Inject into Character Sheet
- Use manual failure/success (system-agnostic only)
- Ability Check Mode (d20, d100, or narrative)

## Module Settings Options
- Debug Logging: enables additional console logging for troubleshooting.
- Inject into Character Sheet: when enabled, the tracker appears as a character sheet tab. When disabled, use the Token Controls button to open the tracker dialog.
- Use manual failure/success (system-agnostic only): replaces automatic rolls with a prompt so players can mark success or failure manually.
- Ability Check Mode: choose between d20 (5e style) DCs, d100 (CoC style) difficulty levels (Easy/Regular/Difficult/Extreme), or narrative outcomes (Triumph/Success/Failure/Despair).

## Configure Tracker (Main Dialog)

### Tracker Selector
- Tracker: choose which tracker to edit.
- Add: create a new tracker and a new character sheet tab.
- Remove: delete the current tracker (disabled if only one exists).

### Tracker Settings
- Tracker Name: label shown in the tracker selector.
- Tab Icon: Font Awesome class for the tab and window icon (example: fas fa-fire).
- Header Label: header text at the top of the tracker tab.
- Tab Label: label shown on the character sheet tab.
- Interval Label: used in button labels and chat messages (example: Weekly).
- Check Roll Mode: per-tracker override for d20/d100/narrative (leave empty to use the module default).
- Restrict to Actor UUIDs: limit visibility to specific actors; drop actor sheets into the field or enter one UUID per line.

### Player Permissions
- Hide DCs for locked checks: hides DCs for locked checks in the tracker tab and Phase Plan view.
- Hide DCs for unlocked checks: hides DCs for unlocked checks in the tracker tab and Phase Plan view.
- Show locked checks to players: if disabled, locked checks are removed from the dropdown and redacted in the Phase Plan.
- View Phase Plan: allows players to open the read-only Phase Plan view from the tracker tab.
- View future plans: allows players to navigate forward to later phases in the read-only Phase Plan.
- Show plan rewards to players: shows gold/item rewards in the read-only Phase Plan.
- Show check chance tooltips: allows players to see success chance tooltips on DC labels in the Phase Plan (default off).
- Show relationships on phase flow view: toggles dependency chips in the read-only Phase Plan.
- Show success/failure lines on phase flow view: toggles narrative lines in the read-only Phase Plan.

### Import/Export Tracker
- Import/Export Tracker: open a dialog to export or import the current tracker only.

### Configuration
- Edit Phase Configuration: open the phase settings dialog.
- Open Flow Diagram: opens a read-only diagram image of phases, groups, and checks in a new window.
- Edit Progress State: open the progress editing dialog.

### Activity Log
- Toggle Success: flips a log entry from success to failure or back.
- Remove Entry: deletes a log entry.
- Recalculate Progress From Log: rebuilds progress based on the log history.

### Maintenance
- Reset Phase Progress: resets progress, completion, and failure streaks.
- Reset Phase Configuration: restores the default phase layout for the current tracker.
- Clear Activity Log: removes all recorded checks.
- Reset Check Count: resets the interval counter.
- Reset All Tracking: resets phases, log, and check count.

### Save Settings
- Save Settings commits changes to the current tracker.

## Manual Skill/Ability Overrides
Use this menu on system-agnostic worlds to override the detected skill/ability list.
- Skills: one per line, `key` or `key: Label`.
- Abilities: one per line, `key` or `key: Label`.
- Leave empty to fall back to detected system values.

## Phase Configuration Dialog
Use this dialog to manage phase metadata and open the Flow editor.

### Phase Tabs
- Phase tabs: one per phase.
- + Add Phase: create a new phase.
- Remove Phase: delete the selected phase (Phase 1 cannot be removed).

### Phase Fields
- Phase Name: display name for the phase.
- Phase Target: number of progress points required to complete the phase (capped to total available checks).
- Allow critical bonus: critical success grants +1 extra progress if the check can still advance.
- Failures trigger events: enables failure event rolls.
- Show rewards on sheet: displays linked phase/check reward items next to the phase subtitle on the character sheet tab.
- Failure Event Table (UUID): roll table UUID used for failure events.
- Phase Image: image shown on the tracker tab.
- Phase Complete Message: message displayed on completion.
- Phase Complete Macro (UUID): macro UUID executed on completion (GM only).
- Phase Complete Gold (gp): gold added/subtracted on completion (negative for costs).
- Phase Complete Items (UUID): drop item(s) to grant on phase completion; supports quantity per item.

### Phase Import/Export
- Import/Export Phase Config: export or import the selected phase only.

### Edit Flow
- Edit Flow opens the Phase Flow editor for the selected phase.

## Phase Flow (Edit Flow)
The Phase Flow editor is where you add and edit groups, checks, dependencies, and narrative lines.

### Groups
- `+ Group`: create a new group lane.
- Double click a group name to edit it.
- Max: set a maximum number of successful checks that can count in the group.
- Remove group: only available if the group has no checks.

### Checks
- `+ Check`: create a new check in a group.
- Double click to edit check name, skill, DC, or description.
- The skill picker includes system skills plus ability checks.
- Remove check: deletes the check.
- Completion options (collapsed by default): set a check to complete its group or phase when it succeeds, run a macro, grant items on success/triumph, or award/cost gold.
- If there is a completion option set then there will be a circular indicator: blue=has macro, red=completes phase/group, orange=has item(s) (multi-configured checks show a blended indicator).
- Check gold rewards apply on success/triumph. If the value is negative (a cost), it applies even on failure/despair.
- Item rewards support multiple entries with quantities; drop items into the list and adjust counts.
- Restricted Actor: drop an actor onto a check to lock it to that actor (clear with the X).

### Dependencies
- Drag a check onto another check to add a dependency.
- Drag a group header onto a check to add a group dependency.
- Dependency chips appear under a check.
- Right click a dependency chip to edit type and effects.
- Click the x on a chip to remove the dependency.

Dependency types and effects:
- Block until completed.
- Prevents when completed (blocks the check once the dependency is complete).
- Harder until completed (DC penalty).
- Advantage when completed.
- Disadvantage until completed.
- Change skill/DC when completed.
- Narrative dependencies (Triumph/Success/Failure/Despair) are treated as OR, while other dependency types are AND.

### Success and Failure Lines
- `+ Line`: add unassigned success or failure lines.
- Drag a line onto a group or check to assign it.
- Unassigned lines act as a fallback when no specific line matches.
- Double click a line to edit its text.

### Flow Zoom
- Zoom slider and buttons are available in the header.
- Ctrl + mouse wheel also zooms the flow.

### Phase Plan (Read Only)
- The tracker tab button View Phase Plan opens a read-only Flow view.
- Player visibility is controlled by the permissions listed above.
- Prev/Next phase navigation is available; future phases require the "View future plans" permission.
- Hover DC labels to see success chance tooltips (GM always, players if permitted).
- When "Show plan rewards to players" is enabled, gold and linked item rewards appear on phase headers and check cards (read-only).
- Checks locked to a different actor are highlighted and show the assigned actor name.

## Dependency Editor Dialog
Open by right clicking a dependency chip in Phase Flow.
- Link Type: block, prevents, harder, advantage, disadvantage, or override.
- Prevents blocks the check once the dependency completes.
- DC penalty: used for harder links.
- Override skill and override DC: used for override links.

## Progress State Dialog
Edit current progress for the tracker.
- Check Count: interval roll counter.
- Per-check progress values for each phase.
- Failures in Row: failure streak per phase.
- Mark Complete: force a phase to completed.

## Import/Export Dialogs
All import/export dialogs use the same controls:
- Export to Text: writes JSON into the text area.
- Download JSON: saves a JSON file.
- Import From Text: reads JSON from the text area.

Available targets:
- Tracker (current tracker only)
- Phase (current phase only)
- Settings (all trackers and configuration)
- State (all trackers and progress)

## Tracker Tab (Player and GM View)
- Phase header with phase number and name.
- Phase progress bar plus per-group progress bars.
- Phase image (if set).
- Check selection dropdown with Current Focus and dependency tooltip.
- Roll button using the interval label.
- Recent Activity log with success/failure lines and event results.
- View Phase Plan button (if enabled).
- If sheet injection is disabled, open the tracker from Token Controls instead.

## Roll and Log Behavior
- Success advances progress and may trigger a success line.
- Failure may trigger a failure line and a failure event table roll if enabled.
- Critical successes can grant bonus progress when allowed.
- Phase completion creates a log entry, optional message, and optional macro execution.
- Item rewards post a chat message that lists what was granted and to whom.
