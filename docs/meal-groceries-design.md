# Meals to groceries (6.3)

Phone Meals links to a week-based grocery review. Choose whole meals/days or
individual ingredient lines. Saved quantities are scaled on the server from the
meal's saved recipe and servings. Free-text meals explain manual entry. Nothing
is written by previewing.

Each ingredient shows its source date, slot, meal and serving count, editable
numeric or text quantity, optional compatible unchecked grocery target, and prior
purchase count. Previously added lines start unselected. Selecting one again
requires “Buy this ingredient again”. Counts survive checks, clears and manual
edits. A changed saved recipe or serving count is a new source snapshot; notes
alone are not. Preview explains that existing purchases remain unchanged.

New rows stay separate by default. An explicit “Combine matching selected
ingredients” option combines numeric lines only when names and units match after
trimming/collapsing whitespace and ignoring case. Optional existing-item merges
use the same rule, strict invariant decimal quantities and reviewed item versions.
No unit conversion, synonyms, fuzzy matching or automatic manual-item merging.
Supported numeric merge quantities have at most four decimal places; higher
precision manual quantities stay separate. Numeric-looking recipe text retains
its text marker in Grocery and is never offered as a numeric merge target.
All new rows go into Grocery's Other category; merged rows retain their category.

Normal: meal groups, selection count, quantities, merge choices and final Add
confirmation. Empty: no planned meals, or recipes needed for free-text meals.
Loading: loading preview with retry after failure. Saving freezes submitted
intent. Definite refusal retains draft; stale source/count/merge conflict blocks
resubmission until Review latest reloads the preview and resets choices.
Uncertain replies retain one exact command and offer Check grocery save even
after closing/leaving the editor. Reconnecting preserves the review and shows
that newer information is available without replacing quantities/choices.
Family changes clear the review, receipts in memory and late replies.

Wall retains its ordinary grocery list and receives generated items live, with
expandable original meal/ingredient provenance. Phone gets the same provenance.
Controls are at least 44px phone and 56px wall. Existing tokens and shared forms
are used. No grocery-generation controls are added to the wall.

GET /api/meals/groceries?from=&to= reads 1–7 local days, the protected Grocery,
both revisions and source counts in one repeatable-read transaction.
POST /api/meals/groceries takes an immutable batch ID, reviewed list ID and
1–500 ingredient choices. Each choice has date/slot, meal version, snapshot
fingerprint, ingredient ID, quantity, prior count, explicit additional-purchase
permission and optional merge item/version. Validate all sources and targets in
the current family before committing. Advisory locks are always lists(51) then
meals(61), compatible with existing single-domain writers.

GroceryBatch stores a canonical request and immutable result. An exact retry
returns the same batch without replaying additions; changed-body reuse conflicts.
GroceryContribution persists immutable provenance and source identity separately
from mutable grocery quantity/text. Its family-scoped source index supports count
checks under the same lock. Contributions advance meals (preview counts) and
lists (provenance) revisions atomically; receipts alone do not. Family deletion
cascades all feature records. Quantity text expands to 100 characters so recipes'
existing free-text quantities remain intact.
