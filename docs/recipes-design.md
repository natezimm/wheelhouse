# Saved recipes (6.2)

Recipes live inside Meals, with a library link on both layouts. Phone parents can
create, edit and archive; the wall and every family client can read, choose a
recipe for a slot and change that slot's servings. No import or grocery action.

Phone library: stacked title/servings cards, New recipe, active/archive filter.
Editor: title, default servings, ingredient rows (name, numeric quantity OR text
quantity, optional unit), ordered preparation steps, source URL and notes.
Archiving requires confirmation. Detail: servings control, scaled ingredients,
numbered instructions and source link. Wall detail uses larger type and 56px
controls; phone controls are at least 44px.

Meal editor: free-text title/notes as before; Choose recipe opens the library.
Selecting previews a frozen recipe, servings and ingredients before Save meal.
Recipe title is read-only until explicitly changed to a free-text meal.
An existing planned recipe opens its saved detail, even if archived. Use latest
recipe explicitly replaces the snapshot after reviewing the current library
version. Changing servings uses the saved snapshot, never the current recipe.
Copy week copies snapshot and serving count with the reviewed slot versions.

States: initial loading and retry; empty library explains creating on the phone;
normal cards/detail; saving freezes submitted intent; definite failure preserves
the draft; stale conflicts require Review latest; uncertain saves retain an exact
receipted command with Check save, also available after closing the editor.
Reconnecting keeps confirmed data, detail and drafts. Family changes clear all
state and ignore old replies. Live refresh does not replace open drafts.

API: parent PUT /api/recipes/{id} with immutable command ID, reviewed version and
desired archived state. Family GET /api/recipes includes archived definitions.
Recipes and slots share the meals revision and advisory lock; read snapshots use
repeatable read. Every recipe is family-filtered and cascades on family deletion.
Receipt IDs share MealCommand's namespace and normalized fingerprints.

Slot PUT optionally selects a recipe ID plus reviewed version. The server copies
its title, default servings, ingredient IDs/content, steps, notes and source URL
into an immutable JSON snapshot. Existing snapshots are retained by default;
RemoveRecipe explicitly converts to free text. Clear removes the snapshot.
The current recipe must be active and family-owned when selecting/refreshing.
No foreign key ties saved history to the mutable recipe.

Servings are whole numbers 1–100. Numeric quantities are nonnegative decimals,
up to 1,000,000 with at most four decimal places. Text quantities stay unchanged;
no units are converted. Ingredient IDs are unique within a recipe and preserved
in snapshots for the next increment. Display scaling rounds to four decimal
places; the original decimal and base servings are always retained.
