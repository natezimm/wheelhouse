using System.Text.Json;
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

        void Add(string title, string? notes, Guid? memberId, DateOnly dueDate, DateTimeOffset? completed = null)
        {
            family.Chores.Add(new Chore
            {
                Id = Guid.CreateVersion7(), FamilyId = family.Id, CreationId = Guid.NewGuid(),
                CreationRequest = JsonSerializer.Serialize(new ChoreDraft(title, notes, memberId, dueDate)),
                Title = title, Notes = notes, MemberId = memberId, DueDate = dueDate, CompletedAt = completed,
            });
        }
    }
}
