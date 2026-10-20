using System.Globalization;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Chores;
using Wheelhouse.Api.Devices;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Lists;
using Wheelhouse.Api.Meals;

namespace Wheelhouse.Api.Demo;

/// <summary>Maps the fictional dataset into one visitor's independent EF aggregate.</summary>
internal static class DemoSeedAdapter
{
    public static Family Create(Guid familyId, DateTimeOffset expiresAt)
    {
        var created = expiresAt - DemoCopies.Lifetime;
        var seed = DemoSeedData.Build(created);
        // The caller owns identity and expiry. EF owns concurrency tokens and domain revisions;
        // seed-record versions are descriptive, not persisted concurrency values.
        var family = new Family
        {
            Id = familyId, Name = seed.Family.Name, TimeZone = seed.Family.TimeZoneId,
            Latitude = (double)seed.Family.Latitude, Longitude = (double)seed.Family.Longitude,
            ExpiresAt = expiresAt,
        };
        family.Members.AddRange(seed.Members.Select(m => new Member
        {
            Id = m.Id, FamilyId = family.Id, DisplayName = m.Name, Initial = m.Name[..1],
            Color = m.ColorHex, Role = m.Role == "Parent" ? MemberRole.Parent : MemberRole.Kid,
            SortOrder = m.SortOrder,
        }));
        family.Devices.Add(new Device
        {
            Id = Guid.CreateVersion7(), FamilyId = family.Id, Name = "Kitchen wall",
            PairedAt = created, LastSeenAt = created,
        });

        foreach (var source in seed.Calendars.All)
        {
            var calendar = new CalendarSource
            {
                Id = source.Id, FamilyId = family.Id, GoogleCalendarId = $"demo-{source.Id:N}",
                Name = source.Name, MemberId = source.MemberId, CanWrite = source.CanWrite,
            };
            calendar.Events.AddRange(seed.Events.Where(e => e.CalendarSourceId == source.Id).Select(e => new EventInstance
            {
                Id = e.Id, FamilyId = family.Id, CalendarSourceId = source.Id,
                GoogleEventId = $"demo-{e.Id:N}", RecurringEventId = e.SeriesId, ETag = e.ETag,
                Title = e.Title, Location = e.Location, StartsAt = e.StartUtc, EndsAt = e.EndUtc,
                StartDate = e.StartDate, EndDate = e.EndDateExclusive,
            }));
            family.Calendars.Add(calendar);
        }

        foreach (var definition in seed.ChoreDefinitions)
        {
            var planSeed = seed.ChorePlans.SingleOrDefault(p => p.ChoreId == definition.Id);
            var draft = planSeed is { } p
                ? new ChoreDraft(p.Title, p.Notes, p.AssignedMemberId, p.EffectiveFrom,
                    new ChoreRepeat(p.Frequency, p.IntervalWeeks, p.Weekdays.ToArray(), p.EndsOn))
                : new ChoreDraft(definition.OneTimeTitle!, definition.OneTimeNotes,
                    definition.OneTimeAssigneeId, definition.OneTimeDueDate!.Value);
            var chore = new Chore
            {
                Id = definition.Id, FamilyId = family.Id, CreationId = Guid.NewGuid(),
                CreationRequest = ChoreOccurrences.Fingerprint(draft), Title = draft.Title,
                Notes = draft.Notes, MemberId = draft.MemberId, DueDate = draft.DueDate,
                Archived = definition.IsArchived,
                CompletedAt = definition.OneTimeCompletedAtUtc is { } at ? NotAfterCreation(at) : null,
            };
            if (planSeed is not null)
            {
                var plan = new ChorePlan
                {
                    Id = planSeed.Id, FamilyId = family.Id, ChoreId = chore.Id,
                    EffectiveFrom = planSeed.EffectiveFrom, Title = draft.Title, Frequency = planSeed.Frequency,
                };
                plan.Apply(draft);
                chore.Plans.Add(plan);
            }
            chore.Completions.AddRange(seed.ChoreCompletions.Where(c => c.ChoreId == chore.Id).Select(c => new ChoreCompletion
            {
                FamilyId = family.Id, ChoreId = chore.Id, DueDate = c.DueDate,
                CompletedAt = NotAfterCreation(c.CompletedAtUtc),
            }));
            family.Chores.Add(chore);
        }

        var snapshots = new Dictionary<Guid, RecipeSnapshot>();
        foreach (var recipeSeed in seed.Recipes)
        {
            var content = new RecipeContent(recipeSeed.Title, recipeSeed.DefaultServings,
                recipeSeed.Ingredients.Select(i => new Ingredient(Guid.NewGuid(), i.Name, i.Quantity,
                    i.Quantity is null ? i.QuantityText : null, i.Unit)).ToArray(),
                recipeSeed.Steps.ToArray(), recipeSeed.SourceUrl, recipeSeed.Notes);
            var recipe = new Recipe
            {
                Id = recipeSeed.Id, FamilyId = family.Id, Archived = recipeSeed.IsArchived,
                Content = RecipeJson.Write(content),
            };
            family.Recipes.Add(recipe);
            snapshots.Add(recipe.Id, new RecipeSnapshot(recipe.Id, recipe.Version, content));
        }
        family.Meals.AddRange(seed.MealSlots.Select(m => new MealSlot
        {
            Id = m.Id, FamilyId = family.Id, Date = m.Date, Slot = m.MealType,
            Title = m.Title, Notes = m.Notes, Servings = m.Servings,
            RecipeData = m.RecipeId is { } id ? RecipeJson.Write(snapshots[id]) : null,
        }));

        foreach (var listSeed in seed.Lists)
        {
            var list = new HouseholdList
            {
                Id = listSeed.Id, FamilyId = family.Id, CreationId = Guid.NewGuid(),
                CreationRequest = "demo", Name = listSeed.Name, IsGrocery = listSeed.IsGrocery,
                Archived = listSeed.IsArchived,
            };
            if (list.IsGrocery)
                foreach (var name in GroceryList.DefaultCategories)
                    list.Categories.Add(new GroceryCategory
                    {
                        Id = Guid.CreateVersion7(), FamilyId = family.Id, HouseholdListId = list.Id,
                        Name = name, SortOrder = list.Categories.Count, IsOther = name == "Other",
                    });
            foreach (var row in listSeed.Items)
            {
                var item = new ListItem
                {
                    Id = row.Id, FamilyId = family.Id, HouseholdListId = list.Id,
                    CreationId = Guid.NewGuid(), CreationRequest = "demo", Text = row.Text,
                    Notes = row.Notes, Checked = row.Checked, SortOrder = row.SortOrder,
                    Quantity = row.Quantity?.ToString(CultureInfo.InvariantCulture) ?? row.QuantityText,
                    QuantityIsText = row.Quantity is null && row.QuantityText is not null,
                    Unit = row.Unit, CategoryId = list.Categories.SingleOrDefault(c => c.Name == row.Category)?.Id,
                };
                if (row.SourceMealSlotId is { } mealId && row.SourceBatchId is { } batchId)
                {
                    var meal = family.Meals.Single(m => m.Id == mealId);
                    var snapshot = RecipeJson.Read<RecipeSnapshot>(meal.RecipeData!);
                    var ingredient = snapshot.Content.Ingredients.Single(i => i.Name == row.Text)
                        .Scale(meal.Servings!.Value, snapshot.Content.DefaultServings);
                    item.Contributions.Add(new GroceryContribution
                    {
                        Id = Guid.CreateVersion7(), FamilyId = family.Id, ListItemId = item.Id,
                        Date = meal.Date, Slot = meal.Slot, SnapshotKey = GrocerySources.Key(meal),
                        IngredientId = ingredient.Id,
                        SourceData = RecipeJson.Write(new GroceryOrigin(batchId, meal.Date, meal.Slot,
                            meal.Title!, ingredient.Name, snapshot.Id, snapshot.Version, meal.Servings.Value,
                            ingredient.Quantity, ingredient.QuantityText, ingredient.Unit)),
                    });
                }
                list.Items.Add(item);
            }
            family.Lists.Add(list);
        }
        foreach (var batch in seed.GroceryBatches)
        {
            var itemIds = seed.Lists.SelectMany(l => l.Items).Where(i => i.SourceBatchId == batch.Id).Select(i => i.Id).ToArray();
            family.GroceryBatches.Add(new GroceryBatch
            {
                Id = batch.Id, FamilyId = family.Id, Request = batch.OperationId,
                Result = RecipeJson.Write(new GroceryBatchResponse(batch.Id, NotAfterCreation(batch.CreatedAtUtc), itemIds.Length, itemIds)),
            });
        }
        return family;

        // A demo started before breakfast must not contain completions or receipts from the future.
        DateTimeOffset NotAfterCreation(DateTimeOffset value) => value > created ? created : value;
    }
}
