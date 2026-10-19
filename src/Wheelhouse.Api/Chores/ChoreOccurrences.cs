using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Wheelhouse.Api.Chores;

public static class ChoreOccurrences
{
    public static DateOnly Today(string zone, DateTimeOffset instant) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(instant, zone).DateTime);

    public static ChoreDraft Draft(Chore chore) => new(chore.Title, chore.Notes, chore.MemberId,
        chore.DueDate, chore.Plans.OrderByDescending(p => p.EffectiveFrom).FirstOrDefault()?.Repeat());

    // Preserve the original one-time creation fingerprint across this additive upgrade.
    public static string Fingerprint(ChoreDraft draft) => draft.Repeat is null
        ? JsonSerializer.Serialize(new { draft.Title, draft.Notes, draft.MemberId, draft.DueDate })
        : JsonSerializer.Serialize(draft);

    public static bool Scheduled(ChorePlan plan, DateOnly day)
    {
        if (day < plan.StartsOn || day < plan.EffectiveFrom || day > plan.EndsOn) return false;
        if (plan.Frequency == "Daily") return true;
        var monday = plan.StartsOn.AddDays(-(((int)plan.StartsOn.DayOfWeek + 6) % 7));
        var weeks = (day.DayNumber - monday.DayNumber) / 7;
        return plan.IntervalWeeks > 0 && weeks % plan.IntervalWeeks == 0
            && (plan.WeekdaysMask & (1 << (int)day.DayOfWeek)) != 0;
    }

    public static ChoreResponse Response(Chore chore, DateOnly day, DateOnly today)
    {
        if (chore.Plans.Count == 0) return ChoreResponse.From(chore);
        var plan = chore.Plans.Where(p => p.EffectiveFrom <= day).MaxBy(p => p.EffectiveFrom);
        var latest = chore.Plans.MaxBy(p => p.EffectiveFrom)!;
        var completion = chore.Completions.SingleOrDefault(c => c.DueDate == day);
        var archived = chore.ArchivedFrom is { } stop && day >= stop;
        var visible = plan is not null && Scheduled(plan, day) && !archived;
        var snapshot = plan ?? latest;
        var version = completion?.Version ?? new Guid(SHA256.HashData(Encoding.UTF8.GetBytes($"{chore.Id:N}:{snapshot.Version:N}:{day:yyyy-MM-dd}"))[..16]);
        return new(chore.Id, chore.CreationId, snapshot.Title, snapshot.Notes, snapshot.MemberId,
            day, completion?.CompletedAt, archived, version, snapshot.Repeat(), chore.Version, Draft(chore),
            visible, visible && day < today && completion?.CompletedAt is null, chore.Archived,
            chore.Plans.Where(p => p.EffectiveFrom > today).Select(p => (DateOnly?)p.EffectiveFrom).Min(),
            $"{chore.Id:N}:{day:yyyy-MM-dd}", chore.ArchivedFrom);
    }
}
