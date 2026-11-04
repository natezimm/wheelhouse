using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Reminders;

/// <summary>What a reminder says, as the service worker shows it, and the screen tapping it opens.</summary>
public sealed record ReminderMessage(string Title, string Body, string Url, string Tag);

/// <summary>
/// Sends each subscribed browser a push for every timed event of its people that starts within its
/// lead time, once. An event added or moved into that time is reminded at the next pass, however
/// soon it starts. All-day events have no time to be early for, so they are left out.
/// </summary>
public sealed class ReminderSender(WheelhouseDbContext db, WebPush push, ParentSignIn parents, TimeProvider time, ILogger<ReminderSender> logger)
{
    /// <summary>Sends what is due now, across every family. Returns how many reminders went out.</summary>
    public async Task<int> SendDueAsync(CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        // No request, so no current family: every query names what it reads across families.
        var subscriptions = await db.ReminderSubscriptions.IgnoreQueryFilters().AsNoTracking().ToListAsync(cancellationToken);
        var due = new List<(ReminderSubscription To, SentReminder Sent, ReminderMessage Message)>();
        var revoked = new HashSet<Guid>();

        foreach (var all in subscriptions.GroupBy(s => s.FamilyId))
        {
            var found = await db.Families.IgnoreQueryFilters().Where(f => f.Id == all.Key)
                .Select(f => new { f.TimeZone, f.ExpiresAt }).SingleOrDefaultAsync(cancellationToken);
            if (found is null || found.ExpiresAt <= now)
            {
                continue;
            }

            // Only browsers that could still read the calendar hear about it: as on every request, a
            // parent demoted or taken off the parent list loses access at once. A browser with no
            // account is a demo visitor's, on a copy that has not expired.
            var family = new List<ReminderSubscription>();
            foreach (var subscription in all)
            {
                var allowed = subscription.AccountId is { } account
                    ? await parents.IsStillAllowedAsync(account, cancellationToken)
                    : found.ExpiresAt is not null;
                if (allowed)
                {
                    family.Add(subscription);
                }
                else
                {
                    revoked.Add(subscription.Id);
                }
            }

            if (family.Count == 0)
            {
                continue;
            }

            var until = now.AddMinutes(family.Max(s => s.LeadMinutes));
            var zone = TimeZoneInfo.FindSystemTimeZoneById(found.TimeZone);
            var events = await db.EventInstances.IgnoreQueryFilters()
                .Where(e => e.FamilyId == all.Key && e.StartDate == null && e.StartsAt > now && e.StartsAt <= until)
                .Join(db.CalendarSources.IgnoreQueryFilters(), e => e.CalendarSourceId, s => s.Id,
                    (e, s) => new { e.Id, e.CalendarSourceId, e.GoogleEventId, e.Title, e.Location, StartsAt = e.StartsAt!.Value, Owner = s.MemberId, e.MemberIds })
                .ToListAsync(cancellationToken);
            if (events.Count == 0)
            {
                continue;
            }

            var ids = family.Select(s => s.Id).ToList();
            var sent = (await db.SentReminders.Where(r => ids.Contains(r.SubscriptionId) && r.StartsAt > now).ToListAsync(cancellationToken))
                .Select(r => (r.SubscriptionId, r.EventKey)).ToHashSet();

            foreach (var subscription in family)
            {
                var through = now.AddMinutes(subscription.LeadMinutes);
                foreach (var e in events.Where(e => e.StartsAt <= through).OrderBy(e => e.StartsAt))
                {
                    var key = KeyOf(e.CalendarSourceId, e.GoogleEventId, e.StartsAt);
                    List<Guid> people = e.Owner is { } owner ? [owner, .. e.MemberIds] : e.MemberIds;
                    if (sent.Add((subscription.Id, key)) && (people.Count == 0 || people.Any(subscription.MemberIds.Contains)))
                    {
                        due.Add((subscription, new SentReminder { SubscriptionId = subscription.Id, EventKey = key, StartsAt = e.StartsAt },
                            Message(e.Id, e.Title, e.Location, e.StartsAt, now, zone)));
                    }
                }
            }
        }

        if (revoked.Count > 0)
        {
            await db.ReminderSubscriptions.IgnoreQueryFilters().Where(s => revoked.Contains(s.Id)).ExecuteDeleteAsync(cancellationToken);
            logger.LogInformation("Removed {Count} reminder subscriptions whose browsers no longer have access", revoked.Count);
        }

        // Kept before sending, so a pass that fails halfway never reminds anyone twice.
        db.SentReminders.AddRange(due.Select(d => d.Sent));
        await db.SaveChangesAsync(cancellationToken);
        await db.SentReminders.Where(r => r.StartsAt < now.AddDays(-1)).ExecuteDeleteAsync(cancellationToken);

        var delivered = 0;
        var gone = new HashSet<Guid>();
        foreach (var (to, _, message) in due)
        {
            if (gone.Contains(to.Id))
            {
                continue;
            }

            switch (await push.SendAsync(new PushTarget(to.Endpoint, to.P256dh, to.Auth), message, to.Site, cancellationToken))
            {
                case PushOutcome.Sent:
                    delivered++;
                    break;
                case PushOutcome.Gone:
                    gone.Add(to.Id);
                    break;
            }
        }

        if (gone.Count > 0)
        {
            // The browser unsubscribed, or its user turned notifications off: stop for good.
            await db.ReminderSubscriptions.IgnoreQueryFilters().Where(s => gone.Contains(s.Id)).ExecuteDeleteAsync(cancellationToken);
            logger.LogInformation("Removed {Count} reminder subscriptions their push service no longer has", gone.Count);
        }

        return delivered;
    }

    public static string KeyOf(Guid calendarId, string googleEventId, DateTimeOffset startsAt) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{calendarId:N}|{googleEventId}|{startsAt.UtcTicks}")));

    public static ReminderMessage Message(Guid id, string title, string? location, DateTimeOffset startsAt, DateTimeOffset now, TimeZoneInfo zone)
    {
        var local = TimeZoneInfo.ConvertTime(startsAt, zone);
        var minutes = (int)Math.Ceiling((startsAt - now).TotalMinutes);
        List<string> parts = [In(minutes), ClockText(local)];
        if (!string.IsNullOrWhiteSpace(location))
        {
            parts.Add(location.Trim());
        }

        return new ReminderMessage(
            string.IsNullOrWhiteSpace(title) ? "(No title)" : title.Trim(),
            string.Join(" · ", parts),
            $"/?day={DateOnly.FromDateTime(local.DateTime):yyyy-MM-dd}&event={id}",
            id.ToString());
    }

    /// <summary>How long until it starts, as "In 15 min" or "In 1 hr 30 min".</summary>
    private static string In(int minutes) => minutes switch
    {
        <= 1 => "Starting now",
        < 60 => $"In {minutes} min",
        _ when minutes % 60 == 0 => $"In {minutes / 60} hr",
        _ => $"In {minutes / 60} hr {minutes % 60} min",
    };

    /// <summary>A clock time the way the screens write it: "3 pm", "3:30 pm" (core/days.ts, clockText).</summary>
    public static string ClockText(DateTimeOffset local)
    {
        var half = local.Hour < 12 ? "am" : "pm";
        var hour = local.Hour % 12 == 0 ? 12 : local.Hour % 12;
        return local.Minute == 0
            ? string.Create(CultureInfo.InvariantCulture, $"{hour} {half}")
            : string.Create(CultureInfo.InvariantCulture, $"{hour}:{local.Minute:00} {half}");
    }
}
