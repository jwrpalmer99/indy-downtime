# Indy Downtime Tracker Settings Guide

This guide covers every menu, dialog, and option in the current UI.

## Module Settings Entries
Open Game Settings -> Module Settings -> Indy Downtime Tracker **as GM**. You will see:
- Configure Tracker (main settings dialog)
- Export/Import Settings (all tracker configuration)
- Export/Import State (all tracker progress and state)

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
- Restrict to Actor UUIDs: limit visibility to specific actors; drop actor sheets into the field or enter one UUID per line.

### Player Permissions
- Hide DCs from players: hides DCs in the tracker tab and Phase Plan view.
- Show locked checks to players: if disabled, locked checks are removed from the dropdown and redacted in the Phase Plan.
- View Phase Plan: allows players to open the read-only Phase Plan view from the tracker tab.
- Show relationships on phase flow view: toggles dependency chips in the read-only Phase Plan.
- Show success/failure lines on phase flow view: toggles narrative lines in the read-only Phase Plan.

### Import/Export Tracker
- Import/Export Tracker: open a dialog to export or import the current tracker only.

### Configuration
- Edit Phase Configuration: open the phase settings dialog.
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
- Failure Event Table (UUID): roll table UUID used for failure events.
- Phase Image: image shown on the tracker tab.
- Phase Complete Message: message displayed on completion.
- Phase Complete Macro (UUID): macro UUID executed on completion (GM only).

### Phase Import/Export
- Import/Export Phase Config: export or import the selected phase only.

### Edit Flow
- Edit Flow opens the Phase Flow editor for the selected phase.

## Phase Flow (Edit Flow)
The Phase Flow editor is where you add and edit groups, checks, dependencies, and narrative lines.

### Groups
- `+ Group`: create a new group lane.
- Drag a group header to reorder groups.
- Double click a group name to edit it.
- Max: set a maximum number of successful checks that can count in the group.
- Remove group: only available if the group has no checks.

### Checks
- `+ Check`: create a new check in a group.
- Drag checks to reorder within a group.
- Double click to edit check name, skill, DC, or description.
- The skill picker includes system skills plus ability checks.
- Remove check: deletes the check.

### Dependencies
- Drag a check onto another check to add a dependency.
- Drag a group header onto a check to add a group dependency.
- Dependency chips appear under a check.
- Right click a dependency chip to edit type and effects.
- Click the x on a chip to remove the dependency.

Dependency types and effects:
- Block until completed.
- Harder until completed (DC penalty).
- Advantage when completed.
- Disadvantage until completed.
- Change skill/DC when completed.

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

## Dependency Editor Dialog
Open by right clicking a dependency chip in Phase Flow.
- Link Type: block, harder, advantage, disadvantage, or override.
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

## Roll and Log Behavior
- Success advances progress and may trigger a success line.
- Failure may trigger a failure line and a failure event table roll if enabled.
- Critical successes can grant bonus progress when allowed.
- Phase completion creates a log entry, optional message, and optional macro execution.