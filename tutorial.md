# Indy Downtime Tracker Tutorial

This walkthrough builds a two-phase downtime project for making and serving soup. It uses DnD5e skills, but you can swap in any system-appropriate skills.

Project overview:
- Phase 1: Make Soup (6 checks)
  - Group: Preparation
    - Gather ingredients (Nature DC 12)
    - Prepare ingredients (Sleight of Hand DC 12)
    - Light a fire (Survival DC 12)
  - Group: Cooking
    - Brown meat (Survival DC 12)
    - Cook soup (Survival DC 12)
    - Flavor soup (Insight DC 14)
- Phase 2: Serve the Soup (3 checks)
  - Group: Invite Guests
    - Convince everyone to come (Persuasion DC 13)
  - Group: Serving
    - Set the table (Performance DC 12)
    - Serve soup (Sleight of Hand DC 12)

## 1) Create a tracker
1. Open Game Settings -> Module Settings -> Indy Downtime Tracker: Configure Tracker.
2. Click Add and then select the new tracker in the dropdown
3. Expand Tracker Settings - name the tracker Soup.
4. Set labels as desired:
   - Header Label: Make and Serve Soup
   - Tab Label: Soup
   - Interval Label: Soup - this is just a label not necessarily a cadence.
   - Tab Icon: fas fa-utensils (any Font Awesome class)
5. Optional: restrict the tracker to specific actors using Restrict to Actor UUIDs
6. Optional: expand and configure Player Permissions.

## 2) Set up phases
1. Click Edit Phase Configuration.
2. Phase 1:
   - Rename to Make Soup.
   - Set Phase Target to 6 (one per check).
   - Optional: enable Allow critical bonus.
3. Click + Add Phase:
   - Rename Pahase 2 to Serve the Soup.
   - Set Phase Target to 3.
4. For each phase, click Edit Flow to build groups and checks.

## 3) Build Phase 1 in Edit Flow
> [Note]
> Double click anything (names/skills/text etc) in Phase Flow window to edit it
1. Click Edit Flow for Make Soup.
2. Click + Group - add two groups and rename them to
   - Preparation
   - Cooking
3. Use + Check to add checks to Preparation:
   - Gather ingredients (Nature DC 12)
   - Prepare ingredients (Sleight of Hand DC 12)
   - Light a fire (Survival DC 12)    
5. Add checks to Cooking:
   - Brown meat (Survival DC 12)
   - Cook soup (Survival DC 12)
   - Flavor soup (Insight DC 14)

> [Tip]
> Your Phase Flow should look like this now
<img width="279" alt="soup_p1_a" src="https://github.com/user-attachments/assets/ee24b8af-0f6d-4b9f-b562-867c92946611" />

## 4) Build Phase 2 in Edit Flow
1. Click Edit Flow for Serve the Soup.
2. Add two groups:
   - Invite Guests
   - Serving
3. Add checks:
   - Invite Guests: Convince everyone to come (Persuasion DC 13)
   - Serving: Set the table (Performance DC 12), Serve soup (Sleight of Hand DC 12)

## 5) Add dependencies
In the Flow view, drag a check onto another check to add a dependency.
- Gather ingredients -> Prepare ingredients
- Light a fire -> Brown meat
- Brown meat -> Cook soup
- Cook soup -> Flavor soup
- Set the table -> Serve soup

Right click a dependency chip to change its type (block, harder, advantage, disadvantage, or override).

## 6) Add narrative lines (optional)
1. In Flow, click + Line under Unassigned Success Lines and Unassigned Failure Lines.
2. Double click a line to edit its text.
3. Drag lines onto a check or group to assign them. Unassigned lines act as fallbacks.

## 7) Save and test
1. Save your changes in each dialog.
2. Open a character sheet and select the Soup tab.
3. Choose a check and click Roll Weekly Check.
4. Review the Recent Activity log and the chat summary.

## Optional enhancements
- Phase image: add a photo in Phase Configuration to display on the tracker tab.
- Failure events: enable Failures trigger events and paste a RollTable UUID.
- Phase completion macro: add a macro UUID that runs when a phase completes.
- Player permissions: hide DCs, hide locked checks, or allow View Phase Plan.

### Macro example (phase completion)
This macro grants a soup item to the actor who completed the phase.

```js
const data = args?.[0] ?? {};
const actor = data.actor ?? game.actors.get(data.actorId);
const item = game.items.getName("Delicious Soup");
if (!actor || !item) {
  ui.notifications.error("Missing actor or item.");
  return;
}
await actor.createEmbeddedDocuments("Item", [item.toObject()]);
ui.notifications.info(`Granted ${item.name} to ${actor.name}.`);
```

Done. You now have a two-phase downtime tracker with dependencies, progress, and narrative flavor.
