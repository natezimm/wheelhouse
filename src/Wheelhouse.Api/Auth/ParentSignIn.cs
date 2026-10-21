using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Auth;

/// <summary>Who Google says signed in, taken from its user info.</summary>
public sealed record GoogleIdentity(string Subject, string Email, bool EmailVerified, string? GivenName, string? Name);

/// <summary>
/// Decides whether a Google account may sign in to this family instance, and as which parent.
/// Only verified addresses on the instance's parent list get in. A parent's first sign-in links
/// their account to a parent member, creating the family itself if this is the very first.
/// </summary>
public sealed class ParentSignIn(
    WheelhouseDbContext db,
    IOptions<InstanceOptions> instance,
    ILogger<ParentSignIn> logger)
{
    /// <summary>The colors the phone offers, in its order; a new parent gets the first one nobody has.</summary>
    private static readonly string[] Colors =
        ["#2F5FC4", "#B85A14", "#137A6D", "#7243B8", "#A8326E", "#2E7D32", "#B3261E", "#5B6470"];

    // Nobody is signed in yet while these run, so there is no current family: each query opts
    // out of the family filter on purpose.

    /// <summary>
    /// The identity the sign-in cookie should carry, or null when this account may not sign in.
    /// <paramref name="timeZone"/> is the browser's, used only if this sign-in creates the family.
    /// </summary>
    public async Task<ClaimsPrincipal?> SignInAsync(GoogleIdentity google, string? timeZone, CancellationToken cancellationToken)
    {
        if (instance.Value.Mode != InstanceMode.Family
            || google.Subject.Length == 0
            || !google.EmailVerified
            || !instance.Value.IsParentEmail(google.Email))
        {
            logger.LogWarning("Refused a Google sign-in for an account that is not on the parent list.");
            return null;
        }

        var account = await db.UserAccounts
            .IgnoreQueryFilters()
            .Include(a => a.Member)
            .SingleOrDefaultAsync(a => a.GoogleSubject == google.Subject, cancellationToken);

        if (account is null)
        {
            account = await LinkAsync(google, timeZone, cancellationToken);
            if (account is null)
            {
                return null;
            }
        }
        else if (account.Member.Role != MemberRole.Parent)
        {
            logger.LogWarning("Refused a Google sign-in for a member who is no longer a parent.");
            return null;
        }

        account.Email = google.Email;
        await db.SaveChangesAsync(cancellationToken);

        return WheelhousePrincipal.Parent(account.FamilyId, account.Id);
    }

    /// <summary>
    /// Checked on every request a parent's cookie makes, so removing them from the family or
    /// from the parent list takes effect at once rather than when the cookie expires.
    /// </summary>
    public async Task<bool> IsStillAllowedAsync(Guid accountId, CancellationToken cancellationToken)
    {
        if (instance.Value.Mode != InstanceMode.Family)
        {
            return false;
        }

        var email = await db.UserAccounts
            .IgnoreQueryFilters()
            .Where(a => a.Id == accountId && a.Member.Role == MemberRole.Parent)
            .Select(a => a.Email)
            .SingleOrDefaultAsync(cancellationToken);

        return email is not null && instance.Value.IsParentEmail(email);
    }

    private async Task<UserAccount?> LinkAsync(GoogleIdentity google, string? timeZone, CancellationToken cancellationToken)
    {
        // A family instance holds one family; demo copies, which have an expiry, never belong here.
        var families = await db.Families
            .IgnoreQueryFilters()
            .Where(f => f.ExpiresAt == null)
            .Include(f => f.Members)
            .Take(2)
            .ToListAsync(cancellationToken);

        if (families.Count > 1)
        {
            logger.LogError("Refused a Google sign-in: this family instance holds more than one family.");
            return null;
        }

        var family = families.SingleOrDefault() ?? CreateFamily(timeZone);
        var linked = await db.UserAccounts
            .IgnoreQueryFilters()
            .Where(a => a.FamilyId == family.Id)
            .Select(a => a.MemberId)
            .ToListAsync(cancellationToken);

        // A parent another parent already added by name becomes this account's member, so the
        // second parent to sign in does not end up listed twice.
        var name = DisplayNameOf(google);
        var member = family.Members.FirstOrDefault(m =>
                         m.Role == MemberRole.Parent
                         && !linked.Contains(m.Id)
                         && string.Equals(m.DisplayName, name, StringComparison.OrdinalIgnoreCase))
                     ?? AddParent(family, name);

        var account = new UserAccount
        {
            Id = Guid.CreateVersion7(),
            FamilyId = family.Id,
            MemberId = member.Id,
            Member = member,
            GoogleSubject = google.Subject,
            Email = google.Email,
        };
        db.UserAccounts.Add(account);

        return account;
    }

    private Family CreateFamily(string? timeZone)
    {
        var family = new Family
        {
            Id = Guid.CreateVersion7(),
            Name = "Our family",
            TimeZone = timeZone is not null && TimeZoneInfo.TryFindSystemTimeZoneById(timeZone, out _) ? timeZone : "UTC",
        };
        db.Families.Add(family);
        return family;
    }

    private Member AddParent(Family family, string name)
    {
        var member = new Member
        {
            Id = Guid.CreateVersion7(),
            FamilyId = family.Id,
            DisplayName = name,
            Color = Colors.FirstOrDefault(color => family.Members.All(m => m.Color != color)) ?? Colors[0],
            Initial = MemberRequest.InitialOf(name),
            Role = MemberRole.Parent,
            SortOrder = family.Members.Select(m => m.SortOrder).DefaultIfEmpty(0).Max() + 1,
        };
        family.Members.Add(member);
        db.Members.Add(member);
        return member;
    }

    private static string DisplayNameOf(GoogleIdentity google)
    {
        var name = new[] { google.GivenName, google.Name, google.Email.Split('@')[0] }
            .First(candidate => !string.IsNullOrWhiteSpace(candidate))!
            .Trim();
        return name.Length > 50 ? name[..50] : name;
    }
}
