using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Families;

public static class FamilyEndpoints
{
    public static IEndpointRouteBuilder MapFamily(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/family", GetFamily).RequireAuthorization(Policies.Family);
        return app;
    }

    /// <summary>The signed-in family and its members, in display order.</summary>
    private static async Task<Results<Ok<FamilyResponse>, NotFound>> GetFamily(
        WheelhouseDbContext db,
        CancellationToken cancellationToken)
    {
        // The query filter already limits this to the caller's own family.
        var family = await db.Families
            .AsNoTracking()
            .Include(f => f.Members.OrderBy(member => member.SortOrder))
            .SingleOrDefaultAsync(cancellationToken);

        return family is null ? TypedResults.NotFound() : TypedResults.Ok(FamilyResponse.From(family));
    }
}

public sealed record FamilyResponse(
    Guid Id,
    string Name,
    string TimeZone,
    DayOfWeek WeekStartsOn,
    IReadOnlyList<MemberResponse> Members)
{
    public static FamilyResponse From(Family family) => new(
        family.Id,
        family.Name,
        family.TimeZone,
        family.WeekStartsOn,
        [.. family.Members.Select(member => new MemberResponse(member.Id, member.DisplayName, member.Color, member.Initial, member.Role))]);
}

public sealed record MemberResponse(Guid Id, string DisplayName, string Color, string Initial, MemberRole Role);
