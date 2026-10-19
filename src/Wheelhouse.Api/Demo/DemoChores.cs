using Wheelhouse.Api.Chores;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Demo;

public static class DemoChores
{
    public static void AddTo(Family family, DateTimeOffset created)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(created, family.TimeZone).DateTime);
        Add("Set the table", "Plates, cups and napkins for dinner.", family.Members[2].Id, today);
        Add("Take out recycling", null, family.Members[0].Id, today);
        Add("Water the plants", "Check the kitchen herbs too.", null, today.AddDays(-1));
        Add("Put laundry away", null, family.Members[1].Id, today, created.AddHours(-1));
        Add("Pack the library books", null, family.Members[2].Id, today.AddDays(1));

        Repeat("Brush teeth", family.Members[2].Id, new ChoreRepeat("Daily"));
        Repeat("Check the lunch bags", family.Members[0].Id, new ChoreRepeat("Weekly", 1, [1, 2, 3, 4, 5]));
        Repeat("Wash the dog blankets", null, new ChoreRepeat("Weekly", 2, [(int)today.DayOfWeek]));

        void Repeat(string title, Guid? memberId, ChoreRepeat repeat)
        {
            var draft = new ChoreDraft(title, null, memberId, today.AddDays(-14), repeat with { Weekdays = repeat.Weekdays ?? [] });
            var chore = new Chore
            {
                Id = Guid.CreateVersion7(), FamilyId = family.Id, CreationId = Guid.NewGuid(),
                CreationRequest = ChoreOccurrences.Fingerprint(draft), Title = title, MemberId = memberId, DueDate = draft.DueDate,
            };
            var plan = new ChorePlan { FamilyId = family.Id, ChoreId = chore.Id, EffectiveFrom = draft.DueDate, Title = title, Frequency = repeat.Frequency };
            plan.Apply(draft); chore.Plans.Add(plan);
            family.Chores.Add(chore);
        }

        void Add(string title, string? notes, Guid? memberId, DateOnly dueDate, DateTimeOffset? completed = null)
        {
            family.Chores.Add(new Chore
            {
                Id = Guid.CreateVersion7(), FamilyId = family.Id, CreationId = Guid.NewGuid(),
                CreationRequest = ChoreOccurrences.Fingerprint(new ChoreDraft(title, notes, memberId, dueDate)),
                Title = title, Notes = notes, MemberId = memberId, DueDate = dueDate, CompletedAt = completed,
            });
        }
    }
}
