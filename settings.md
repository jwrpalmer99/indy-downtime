# Indy Downtime Tracker Settings Guide

This guide describes every setting and dialog. Sections are laid out with space for screenshots.

---

## Module Settings Overview

[Screenshot: Module Settings panel]

This is the entry point for all configuration. Use it to select a tracker, open dialogs, and run maintenance actions.

---

## Tracker Settings (Collapsed Section)

[Screenshot: Tracker Settings section]

- Tracker Name: Display name for the tracker.
- Tab Icon: Font Awesome class for the tab and window icon (e.g., `fas fa-fire`).
- Hide DCs From Players: Hides DCs in player views.
- Show Locked Checks to Players: If disabled, locked checks are hidden from players.
- Header Label: Title shown at the top of the tracker tab.
- Tab Label: Label shown in the character sheet tab bar.
- Interval Label: Used in UI and chat (e.g., ?Weekly?, ?Hourly?).
- Restrict to Actor UUIDs: If set, only listed actors see the tracker tab.

---

## Tracker Selector and Management

[Screenshot: Tracker selector + Add/Remove buttons]

- Tracker Selector: Switch between trackers.
- Add: Creates a new tracker.
- Remove: Deletes the current tracker.

---

## Phase Configuration Dialog

[Screenshot: Phase Configuration dialog]

This dialog controls phase structure and check design.

### Phase Tabs
[Screenshot: Phase tabs]

- Add Phase: Creates a new phase tab.
- Remove Phase: Removes a phase (except Phase 1).

### Phase Basics
[Screenshot: Phase basics]

- Phase Name
- Phase Image
- Allow Critical Bonus
- Failures Trigger Events
- Failure Event Roll Table
- Phase Complete Message
- Phase Complete Macro

### Groups
[Screenshot: Groups section]

- Add Group
- Group Name
- Group Summary chips

### Checks
[Screenshot: Checks section]

- Check Name
- Skill (skill or ability)
- DC
- Description (shown under the dropdown on the tracker tab)

### Success Lines
[Screenshot: Success lines section]

- Add Line
- Line text

### Failure Lines
[Screenshot: Failure lines section]

- Add Line
- Line text

---

## Flow View (Dependencies)

[Screenshot: Flow View dialog]

Use Flow View to model dependencies and conditional effects.

- Drag checks to create dependencies.
- Drag success/failure lines onto checks or groups.
- Right-click dependency chips to edit effects (DC modifiers, advantage, etc.).

---

## Progress State Dialog

[Screenshot: Progress State dialog]

Edit live state for each phase:

- Group progress
- Check completion
- Failure streaks (if enabled)
- Check count

---

## Activity Log Dialog

[Screenshot: Activity Log dialog]

- Review recent rolls
- Toggle success/failure
- Delete entries
- Recalculate state

---

## Import / Export

[Screenshot: Export/Import section]

- Export Settings: Saves all configuration to JSON.
- Import Settings: Loads configuration from JSON.
- Export State: Saves tracker state to JSON.
- Import State: Loads tracker state from JSON.

---

## Maintenance

[Screenshot: Maintenance section]

- Reset Phase Progress
- Reset Phase Configuration
- Clear Activity Log
- Reset Check Count
- Reset All Tracking

---

## Player View (Character Sheet Tab)

[Screenshot: Character sheet tracker tab]

- Progress by group
- Current focus and tooltip details
- Check selector and roll button
- Recent activity
