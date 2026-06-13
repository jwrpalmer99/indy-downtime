# Indy Downtime Tracker GM and Player Guide

This guide explains how to set up and run downtime activities at the table. Use it when you want a practical workflow for play. Use `settings.md` when you need a full reference for every setting, and `tutorial.md` when you want a worked example.

## What the Tracker Represents

An Indy Downtime tracker is a structured downtime activity. It can model a single project, a shared party goal, or a set of related tasks.

Core terms:
- Tracker: the whole downtime activity, shown as a character sheet tab or Token Controls window.
- Phase: a major step in the activity, such as Research, Preparation, Travel, or Completion.
- Group: a lane of related checks inside a phase, such as Contacts, Materials, or Field Work.
- Check: one actionable task a character can attempt.
- Dependency: a rule that makes one check affect another.
- Progress: successful checks advance the phase until the phase target is met.

## GM Setup Workflow

### 1. Decide the Activity Scope

Before opening the settings menu, define the activity in plain terms:
- What are the players trying to accomplish?
- Is this for one character, several characters, or the whole party?
- How many meaningful steps should it take?
- What can go wrong?
- What rewards, costs, clues, contacts, or complications can result?

Keep the first tracker small. Two or three phases with three to six checks per phase is enough for most downtime projects.

### 2. Create the Tracker

1. Open Game Settings -> Module Settings -> Indy Downtime Tracker: Configure Tracker.
2. Click Add.
3. Select the new tracker.
4. Set the tracker labels:
   - Tracker Name: internal name in the settings dropdown.
   - Header Label: title shown on the tracker tab.
   - Tab Label: short label shown on the character sheet.
   - Interval Label: the roll button label, such as Day, Week, Shift, or Attempt.
   - Tab Icon: a Font Awesome icon class, such as `fas fa-hammer`.
5. Optional: use Restrict to Actor UUIDs if only specific actors should see the tracker.
6. Click Save Settings.

If the tracker tab does not display correctly on your system sheet, disable Inject into Character Sheet and open the tracker from Token Controls instead.

### 3. Configure Player Visibility

Open Player Permissions in the tracker settings and decide how much planning information players should see.

Common presets:
- Open table: enable View Phase Plan, View future plans, Show relationships, and Show success/failure lines.
- Mystery activity: enable View Phase Plan, but hide future plans, locked checks, DCs, relationships, and narrative lines.
- GM-driven activity: disable View Phase Plan and let players interact only with available checks.

GM users can always inspect the full tracker.

### 4. Build Phases

1. Click Edit Phase Configuration.
2. Rename Phase 1.
3. Set Phase Target to the number of progress points needed to complete the phase.
4. Optional: enable Allow critical bonus if critical successes should grant extra progress.
5. Optional: add a Phase Image, completion message, rewards, costs, or a completion macro.
6. Click + Add Phase for additional steps.
7. Save your changes.

Set the target to match the pace you want. A phase with six checks and a target of four lets the party choose a path. A phase with six checks and a target of six requires completion of nearly everything.

### 5. Build the Phase Flow

For each phase:

1. Open Edit Flow.
2. Add groups with + Group.
3. Add checks with + Check.
4. Double click group names, check names, skills, DCs, and descriptions to edit them.
5. Drag checks onto other checks to create dependencies.
6. Right click dependency chips to change the dependency type.
7. Add success or failure lines if you want the tracker to produce narrative results.
8. Save before closing.

Useful dependency patterns:
- Block until completed: use for obvious sequence gates, such as "buy materials before crafting".
- Harder until completed: use when a check is possible but risky without preparation.
- Advantage when completed: use when a prep task improves later checks.
- Disadvantage until completed: use when a missing task makes later work harder.
- Prevents when completed: use for mutually exclusive choices.
- Change skill/DC when completed: use when one path changes how another task is attempted.

### 6. Add Rewards, Costs, and Consequences

Rewards can be attached to checks or phase completion:
- Gold rewards use positive numbers.
- Gold costs use negative numbers.
- Item rewards can be added by dropping items into the reward list.
- Macros can run on successful checks or phase completion.

Failures can add flavor or risk:
- Add failure lines for narrative feedback.
- Enable failure events and provide a RollTable UUID if repeated failures should trigger complications.
- Use Edit Progress State only when you need to correct or manually adjust progress.

### 7. Test Before Play

Before using a tracker in session:

1. Open an actor sheet as GM.
2. Confirm the tracker tab or Token Controls window opens.
3. Check that only intended checks are available.
4. Roll one test check.
5. Review the chat message and Recent Activity log.
6. If using player permissions, test with a player-owned actor or a player account.
7. Reset progress or clear the activity log before the real session if needed.

## Running Downtime as GM

### Start of Downtime

1. Tell players the activity goal and available time interval.
2. Open the tracker.
3. If players can view the plan, have them review View Phase Plan.
4. Ask each participating player which check they want to attempt.
5. Resolve rolls from the tracker.

### During Each Interval

Use the interval label as your cadence. For example, if the label is Week, each roll represents one downtime week.

For each interval:
- Players choose available checks.
- The tracker rolls or prompts for manual success/failure.
- Success advances progress.
- Failure records an activity log entry and may trigger a failure line or event.
- The group and phase progress bars update automatically.
- Completed phases advance to the next phase.

Use the Recent Activity log as the record of what happened. It is useful for recaps, consequences, and fixing mistakes.

### Between Sessions

The GM can maintain the tracker without rebuilding it:
- Export Settings to back up tracker configuration.
- Export State to back up current progress.
- Edit Progress State to fix accidental results.
- Recalculate Progress From Log if the activity log is the source of truth.
- Open Flow Diagram to review or share the phase structure.

## Player Workflow

### Finding the Tracker

Open your character sheet and select the downtime tab. If the GM disabled sheet injection, select your token and open the tracker from Token Controls.

### Choosing a Check

1. Review the current phase, progress bar, and available checks.
2. Open View Phase Plan if the GM has enabled it.
3. Choose a check from the dropdown.
4. Read any dependency tooltip or visible description.
5. Click the roll button.

Some checks may be hidden, locked, assigned to another actor, or waiting on other tasks. This is normal and depends on the GM's setup.

### Reading Results

After a roll:
- Chat shows the roll summary.
- Recent Activity shows the latest success or failure.
- Progress bars update when a success counts toward the phase.
- Rewards, costs, or item grants may appear in chat if configured.
- The next phase opens automatically when the current phase completes.

If manual success/failure mode is enabled, follow the GM's roll instructions and choose the correct result when prompted.

## Designing Good Downtime Activities

Strong downtime trackers usually have:
- A clear goal.
- A visible sense of progress.
- Several different skill approaches.
- At least one optional preparation check.
- Meaningful consequences for failure.
- A reward or story change when the phase completes.

Avoid making every check mandatory unless the activity is meant to be a strict sequence. Players usually get better choices when some checks are alternative routes, preparation tasks, or optional rewards.

## Quick Templates

### Craft an Item

Suggested phases:
- Gather Materials
- Craft and Refine
- Finish or Enchant

Suggested groups:
- Sourcing
- Workshop
- Expertise
- Testing

Good dependencies:
- Materials block crafting.
- Research gives advantage on finishing.
- Poor tools make crafting harder until upgraded.

### Research a Mystery

Suggested phases:
- Find Leads
- Verify Evidence
- Confront the Truth

Suggested groups:
- Archives
- Contacts
- Field Work
- Analysis

Good dependencies:
- A discovered clue unlocks a later check.
- A contact can change the skill or DC for an investigation check.
- A failed lead can trigger a complication table.

### Build Faction Influence

Suggested phases:
- Make Contact
- Prove Value
- Secure Favor

Suggested groups:
- Social
- Resources
- Service
- Reputation

Good dependencies:
- Completing a service check gives advantage on negotiation.
- Spending gold can reduce a DC.
- Choosing one faction favor can prevent a rival faction path.

## Troubleshooting

- Tracker tab missing: disable Inject into Character Sheet and use Token Controls.
- Skills missing or wrong: configure Manual Skill/Ability Overrides.
- Rolls do not work in your system: enable Use manual failure/success.
- Players see too much or too little: adjust Player Permissions on the tracker.
- Progress looks wrong: inspect Recent Activity, then use Recalculate Progress From Log or Edit Progress State.
- Imported JSON fails: confirm you are importing tracker, phase, settings, or state JSON into the matching import dialog.

