using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Reminders;

/// <summary>
/// One browser that asked to be reminded before events: a parent's phone, usually. It belongs to
/// the browser rather than the person, so each phone chooses for itself, and a demo visitor, who
/// has no account, can try it too. A parent's is removed with their account.
/// </summary>
public sealed class ReminderSubscription : IFamilyOwned
{
    public const int MaxEndpoint = 2048;

    /// <summary>How long before an event a browser may ask to hear about it.</summary>
    public static readonly int[] LeadChoices = [5, 10, 15, 30, 60, 120];

    public Guid Id { get; set; }

    public Guid FamilyId { get; set; }

    /// <summary>The signed-in parent's account, or null for a demo visitor.</summary>
    public Guid? AccountId { get; set; }

    /// <summary>The push service's address for this browser. It identifies the subscription.</summary>
    public required string Endpoint { get; set; }

    /// <summary>The browser's public key and secret for encrypting to it (base64url).</summary>
    public required string P256dh { get; set; }

    public required string Auth { get; set; }

    /// <summary>The site the browser subscribed on, which push services are told the reminders come from.</summary>
    public required string Site { get; set; }

    public int LeadMinutes { get; set; } = 15;

    /// <summary>Whose events to remind about; whole-family events always come too.</summary>
    public List<Guid> MemberIds { get; set; } = [];

    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>
/// A reminder already sent, so each event is reminded once per browser. It names the event by its
/// calendar, Google's id and its start, which outlive the cache's own row ids across syncs, so an
/// event moved to another time is reminded again at the new one.
/// </summary>
public sealed class SentReminder
{
    public Guid SubscriptionId { get; set; }

    /// <summary>A hash of the event's calendar, Google id and start (<see cref="ReminderSender.KeyOf"/>).</summary>
    public required string EventKey { get; set; }

    /// <summary>When the event starts; a day later the row is no longer needed.</summary>
    public DateTimeOffset StartsAt { get; set; }
}
