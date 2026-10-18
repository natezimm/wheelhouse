using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Household;

namespace Wheelhouse.Api.Families;

public static class FamilyEndpoints
{
    /// <summary>Anyone in the family can read it; only a parent can change it.</summary>
    public static IEndpointRouteBuilder MapFamily(this IEndpointRouteBuilder app)
    {
        var family = app.MapGroup("/api/family");

        family.MapGet("", GetFamily).RequireAuthorization(Policies.Family);
        family.MapPut("", UpdateFamily).RequireAuthorization(Policies.Parent);
        family.MapPut("location", UpdateLocation).RequireAuthorization(Policies.Parent);
        family.MapPost("members", AddMember).RequireAuthorization(Policies.Parent);
        family.MapPut("members/{id:guid}", UpdateMember).RequireAuthorization(Policies.Parent);
        family.MapDelete("members/{id:guid}", RemoveMember).RequireAuthorization(Policies.Parent);

        return app;
    }

    // In every handler the query filter has already limited the rows to the caller's own family,
    // so another family's member id is simply not found.

    private static async Task<Results<Ok<FamilyResponse>, NotFound>> GetFamily(
        WheelhouseDbContext db,
        CancellationToken cancellationToken)
    {
        var family = await db.Families
            .AsNoTracking()
            .Include(f => f.Members.OrderBy(member => member.SortOrder))
            .SingleOrDefaultAsync(cancellationToken);

        return family is null ? TypedResults.NotFound() : TypedResults.Ok(FamilyResponse.From(family));
    }

    private static async Task<Results<Ok<FamilyResponse>, ValidationProblem, NotFound>> UpdateFamily(
        FamilySettingsRequest request,
        WheelhouseDbContext db,
        CancellationToken cancellationToken)
    {
        var errors = request.Validate();
        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        var family = await db.Families
            .Include(f => f.Members.OrderBy(member => member.SortOrder))
            .SingleOrDefaultAsync(cancellationToken);
        if (family is null)
        {
            return TypedResults.NotFound();
        }

        family.Name = request.Name.Trim();
        family.TimeZone = request.TimeZone;
        family.WeekStartsOn = request.WeekStartsOn;
        family.NightModeFrom = request.NightModeFrom;
        family.NightModeTo = request.NightModeTo;
        family.Units = request.Units;
        await db.SaveChangesAsync(cancellationToken);

        return TypedResults.Ok(FamilyResponse.From(family));
    }

    private static async Task<Results<Ok<FamilyResponse>, ValidationProblem, NotFound>> UpdateLocation(
        FamilyLocationRequest request,
        WheelhouseDbContext db,
        CancellationToken cancellationToken)
    {
        var errors = request.Validate();
        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        var family = await db.Families
            .Include(f => f.Members.OrderBy(member => member.SortOrder))
            .SingleOrDefaultAsync(cancellationToken);
        if (family is null)
        {
            return TypedResults.NotFound();
        }

        // Two decimal places is about a kilometre: enough for the weather, and no more precise
        // than the family needs to share.
        family.Latitude = request.Latitude is { } latitude ? Math.Round(latitude, 2) : null;
        family.Longitude = request.Longitude is { } longitude ? Math.Round(longitude, 2) : null;
        await db.SaveChangesAsync(cancellationToken);

        return TypedResults.Ok(FamilyResponse.From(family));
    }

    private static async Task<Results<Created<MemberResponse>, ValidationProblem, NotFound>> AddMember(
        MemberRequest request,
        WheelhouseDbContext db,
        CancellationToken cancellationToken)
    {
        var errors = request.Validate();
        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        var familyId = await db.Families.Select(family => (Guid?)family.Id).SingleOrDefaultAsync(cancellationToken);
        if (familyId is null)
        {
            return TypedResults.NotFound();
        }

        var member = new Member
        {
            Id = Guid.CreateVersion7(),
            FamilyId = familyId.Value,
            DisplayName = request.DisplayName.Trim(),
            Color = request.Color.ToUpperInvariant(),
            Initial = MemberRequest.InitialOf(request.DisplayName),
            Role = request.Role,
            // New members go last.
            SortOrder = (await db.Members.MaxAsync(m => (int?)m.SortOrder, cancellationToken) ?? 0) + 1,
        };
        db.Members.Add(member);
        await db.SaveChangesAsync(cancellationToken);

        return TypedResults.Created($"/api/family/members/{member.Id}", MemberResponse.From(member));
    }

    private static async Task<Results<Ok<MemberResponse>, ValidationProblem, NotFound>> UpdateMember(
        Guid id,
        MemberRequest request,
        WheelhouseDbContext db,
        CalendarConnections calendar,
        HouseholdConnections household,
        CancellationToken cancellationToken)
    {
        var errors = request.Validate();
        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        var member = await db.Members.SingleOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (member is null)
        {
            return TypedResults.NotFound();
        }

        if (member.Role == MemberRole.Parent && request.Role != MemberRole.Parent && await IsOnlyParent(db, id, cancellationToken))
        {
            return TypedResults.ValidationProblem(LastParent);
        }

        member.DisplayName = request.DisplayName.Trim();
        member.Color = request.Color.ToUpperInvariant();
        member.Initial = MemberRequest.InitialOf(request.DisplayName);
        member.Role = request.Role;
        await db.SaveChangesAsync(cancellationToken);
        await calendar.PublishAsync();
        await household.PublishAsync();

        return TypedResults.Ok(MemberResponse.From(member));
    }

    private static async Task<Results<NoContent, ValidationProblem, NotFound>> RemoveMember(
        Guid id,
        WheelhouseDbContext db,
        CalendarConnections calendar,
        HouseholdConnections household,
        CancellationToken cancellationToken)
    {
        var member = await db.Members.SingleOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (member is null)
        {
            return TypedResults.NotFound();
        }

        if (member.Role == MemberRole.Parent && await IsOnlyParent(db, id, cancellationToken))
        {
            return TypedResults.ValidationProblem(LastParent);
        }

        db.Members.Remove(member);
        await db.SaveChangesAsync(cancellationToken);
        await calendar.PublishAsync();
        await household.PublishAsync();

        return TypedResults.NoContent();
    }

    /// <summary>Settings are parent-only, so a family with no parent could never be managed again.</summary>
    private static readonly Dictionary<string, string[]> LastParent = new()
    {
        ["role"] = ["A family needs at least one parent."],
    };

    private static async Task<bool> IsOnlyParent(WheelhouseDbContext db, Guid memberId, CancellationToken cancellationToken) =>
        !await db.Members.AnyAsync(m => m.Role == MemberRole.Parent && m.Id != memberId, cancellationToken);
}

