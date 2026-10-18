using System.Security.Cryptography;
using System.Text;

namespace Wheelhouse.Api.Calendar;

/// <summary>Stable client correlation without exposing Google's event or series identifiers.</summary>
public static class EventIdentity
{
    // Hex uses only Google's allowed base32hex characters; family scoping prevents cross-family reuse.
    public static string ForCreation(Guid familyId, Guid creationId) => $"ae{familyId:N}{creationId:N}";

    public static string? Series(EventInstance row) => row.RecurringEventId is { } series
        ? Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{row.FamilyId:N}:{series}")))
        : null;

    public static Guid? Creation(EventInstance row)
    {
        var id = row.RecurringEventId ?? row.GoogleEventId;
        var prefix = $"ae{row.FamilyId:N}";
        return id.Length == 66 && id.StartsWith(prefix, StringComparison.Ordinal)
            && Guid.TryParseExact(id[34..], "N", out var creationId) ? creationId : null;
    }
}
