Indy Downtime Manager - Tutorial

This document will walk you through creating a 2 phase activity of making and serving delicious soup!

We will create the following structure:

- Phase 1: Make Soup
  - Group: Preparation
    - Check: Gather ingredients (Nature: DC 12)
    - Check: Prepare ingredients (Sleight of Hand: DC 12)
    - Check: Light a fire (Survival: DC 12)
  - Group: Cooking
    - Check: Brown meat (Survival: DC 12)
    - Check: Cook soup (Survival: DC 12)
    - Check: Flavour soup (Insight: DC 14)

- Phase 2: Serve the Soup
    - Group: Invite Guests
        - Check: Convince everyone to come (Persuassion: DC 13)
    - Group: Serving
        - Check: Set the table (Performance: DC 12)
        - Check: Serve soup (Sleight of Hand: DC 12)

some of these skill checks depend on previous ones being carried out (for example you can't [Prepare ingredients] until you have completed [Gather ingredients]) and some can be done independtly (You can [Set the table] before or after you [Convince everyone to come])

Let's get started!

1. Open the Indy Downtime Manager from the Tools menu in Foundry VTT.
2. Click "Add Tracker" and name your new tracker "Soup"
3. Set the Tab-Icon, Header Label, Tab Label and Interval Label as you like (eg "fa-duotone fa-solid fa-fork-knife", "Make & Serve Soup", "Soup", "Hourly")
4. Click "Edit Phase Configuration
2. An empty Phase 1 is already created - rename it "Make Soup" and set the Phase Target to 6 (this is how many checks must succeed for the phase to be complete)
3. Inside the "Make Soup" phase, expand "Groups" and click "Add Group" to create a group named "Preparation".
4. Within the "Preparation" group, click "Add Check" three times to create the following checks:
   - Gather ingredients (Nature: DC 12)
   - Prepare ingredients (Sleight of Hand: DC 12)
   - Light a fire (Survival: DC 12)
5. Next, scroll back up and create another group named "Cooking" in the same phase.
6. Within the "Cooking" group, add three checks:
   - Brown meat (Survival: DC 12)
   - Cook soup (Survival: DC 12)
   - Flavour soup (Insight: DC 14)
7. Now, add a second phase by clicking "Add Phase" at the top of the dialog; Name this phase "Serve the Soup".
8. Set the Phase Target to 5.
8. Create a group named "Invite Guests".
9. Within the "Invite Guests" group, add a check named "Convince everyone to come (Persuasion: DC 13)".
10. Next, create another group named "Serving".
11. Within the "Serve the Soup" group, add two checks:
    - Set the table (Performance: DC 12)
    - Serve the Soup! (Sleight of Hand: DC 12)
12. Now, let's set up dependencies - drag/drop a check card onto the "Depends On" section of another
    - In the "Preparation" group, set "Prepare ingredients" to depend on "Gather ingredients".
    - In the "Cooking" group, set "Brown meat" to depend on "Light a fire" from the "Preparation" group.
    - In the "Cooking" group, set "Cook soup" to depend on "Brown meat" and "Flavour soup" to depend on "Cook soup".
    - In the "Serve the Soup" phase, set "Serve soup" to depend on "Set the table".
13. Review your downtime activity to ensure everything is set up correctly (press Flow View).
14. Save your downtime activity.

Optionally:
- add an appropriate image for each phase
- add failure/success message for checks (drag/drop the check onto the message card to link them)
- add a macro on phase completion - this can be used (for example) to gift the player some delicious soup!

 macro example: (create a "Delicious Soup" item in your world first) then create a script macro:

    const itemName = "Delicious Soup"; 
    const actorname = scope.actorName; //passed in from Indy Downtime Manager
    const actor = game.actors.getName(actorname);

    const itemToGrant = game.items.getName(itemName);

    if (!itemToGrant) {
        ui.notifications.error(`Item "${itemName}" not found.`);
    } else {
        //grant item to actor
        await actor.createEmbeddedDocuments("Item", [itemToGrant.toObject()]);
        console.log(`Granted ${itemName} to ${actor.name}`);
        ui.notifications.info(`Granted ${itemName} to ${actor.name}`);
    }

Congratulations! You have successfully created a 2 phase downtime activity for making and serving soup using the Indy Downtime Manager. Enjoy your delicious creation!