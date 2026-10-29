# Grocery workflow (5.2)

Lists pins a protected Grocery list first. Both layouts keep text-only quick-add, with expandable optional quantity/unit/category fields. Remaining groceries group by editable category order; checked items collapse below them. Moves work within a category and checked state. Similar entries stay separate.

Manage categories supports adding, renaming, removing and moving up/down, with 1–16 unique names. Other stays last and cannot be renamed or removed. Removing a category moves its items into Other. A list version guards the whole configuration, including concurrent shopping changes.

Clear checked previews a count and exact item names, then sends only their IDs and versions. Reopened or edited reviewed items conflict atomically; newly checked items never enter an old confirmation. Deleted targets are already satisfied. A lost reply checks the reviewed items' absence before retrying the frozen request. Clear batches contain at most 500 items, shown explicitly in the UI.

Normal/empty/loading/saving/failed/reconnecting states follow lists-design.md. Draft fields and reviewed selections remain fixed through live reads. Definite failure restores only the refused overlay. Unknown replies stay frozen with Check save. Explicit Review latest reloads clear/category confirmations; family changes clear drafts. Phone/wall targets are 44/56px. Browser checks use mocked HTTP/WebSocket transports, with screenshots at 390×844 and 1920×1080.

A partial unique index enforces one IsGrocery list per family. The migration backfills existing families with an empty protected list and default categories without changing existing named lists; it advances lists revisions. New private families and demo copies seed Grocery before EF insertion. Categories are family-owned and list-scoped; all changes use the existing lists revision and household connection. GET never creates data. Meals and automatic merging are deferred.
