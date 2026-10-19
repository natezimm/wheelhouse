using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Lists;

public static partial class ListEndpoints
{
    private static bool GroceryFields(HouseholdList list, string? quantity, string? unit, Guid? requestedCategory, out Guid? category)
    {
        category = null;
        if (!list.IsGrocery) return quantity is null && unit is null && requestedCategory is null;
        var id = requestedCategory ?? list.Categories.Single(c => c.IsOther).Id;
        category = id; return list.Categories.Any(c => c.Id == id);
    }

    private static Task<IResult> ClearChecked(Guid id, ClearCheckedItems request, WheelhouseDbContext db, CancellationToken ct) =>
        Change(id, null, db, ct, list =>
        {
            if (!list.IsGrocery || request.Items is not { Length: > 0 and <= 500 }
                || request.Items.Any(i => i is null || i.Id == Guid.Empty || i.Version == Guid.Empty)
                || request.Items.Select(i => i.Id).Distinct().Count() != request.Items.Length) return InvalidGrocery();
            var rows = list.Items.ToDictionary(i => i.Id);
            if (request.Items.Any(i => !rows.ContainsKey(i.Id))) return Results.NotFound();
            if (request.Items.Any(i => !rows[i.Id].Deleted && (!rows[i.Id].Checked || rows[i.Id].Version != i.Version))) return Conflict(list);
            var changed = false;
            foreach (var review in request.Items)
            {
                var item = rows[review.Id]; if (item.Deleted) continue;
                item.Deleted = true; item.Version = Guid.NewGuid(); changed = true;
            }
            if (changed) list.Version = Guid.NewGuid();
            return null;
        });

    private static Task<IResult> Categories(Guid id, EditCategories request, WheelhouseDbContext db, CancellationToken ct) =>
        Change(id, null, db, ct, list =>
        {
            if (!list.IsGrocery || request.Categories is not { Length: > 0 and <= 16 } || request.Categories.Any(c => c is null)) return InvalidGrocery();
            var drafts = request.Categories.Select(c => c with { Name = c.Name?.Trim() ?? "" }).ToArray();
            if (drafts.Any(c => c.Id == Guid.Empty || c.Name.Length is < 1 or > 40)
                || drafts.Select(c => c.Id).Distinct().Count() != drafts.Length
                || drafts.Select(c => c.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count() != drafts.Length) return InvalidGrocery();
            var other = list.Categories.Single(c => c.IsOther);
            if (drafts[^1].Id != other.Id || drafts[^1].Name != "Other") return InvalidGrocery();
            var before = list.Categories.OrderBy(c => c.SortOrder).ThenBy(c => c.Id).Select(c => new CategoryDraft(c.Id, c.Name)).ToArray();
            if (before.SequenceEqual(drafts)) return null;
            if (list.Version != request.Version) return Conflict(list);
            var current = list.Categories.ToDictionary(c => c.Id);
            var newIds = drafts.Where(c => !current.ContainsKey(c.Id)).Select(c => c.Id).ToArray();
            if (db.GroceryCategories.IgnoreQueryFilters().Any(c => newIds.Contains(c.Id))) return InvalidGrocery();
            var kept = drafts.Select(c => c.Id).ToHashSet();
            foreach (var removed in list.Categories.Where(c => !kept.Contains(c.Id)).ToArray())
            {
                foreach (var item in list.Items.Where(i => i.CategoryId == removed.Id)) { item.CategoryId = other.Id; item.Version = Guid.NewGuid(); }
                list.Categories.Remove(removed); db.GroceryCategories.Remove(removed);
            }
            for (var index = 0; index < drafts.Length; index++)
            {
                var draft = drafts[index];
                if (!current.TryGetValue(draft.Id, out var category))
                {
                    category = new GroceryCategory { Id = draft.Id, FamilyId = list.FamilyId, HouseholdListId = list.Id, Name = draft.Name };
                    list.Categories.Add(category); db.GroceryCategories.Add(category);
                }
                category.Name = draft.Name; category.SortOrder = index;
            }
            list.Version = Guid.NewGuid(); return null;
        });

    private static IResult InvalidGrocery() => Results.ValidationProblem(new Dictionary<string, string[]> {
        ["grocery"] = ["Choose a category in this Grocery list. Quantity/unit allow 50 characters each. Keep 1–16 unique category names (up to 40 characters), with Other last. Clear only reviewed checked items (up to 500)."] });
}
