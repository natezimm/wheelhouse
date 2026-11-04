using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Reminders;

public sealed record PushKeyResponse(string PublicKey);

/// <summary>A browser's push subscription and what it wants to be reminded of.</summary>
public sealed record ReminderRequest(string Endpoint, string P256dh, string Auth, int LeadMinutes, List<Guid>? MemberIds)
{
    public Dictionary<string, string[]> Validate()
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrEmpty(Endpoint) || Endpoint.Length > ReminderSubscription.MaxEndpoint || !WebPush.IsPushEndpoint(Endpoint))
        {
            errors["endpoint"] = ["This browser's push service is not one Wheelhouse can send to."];
        }

        if (string.IsNullOrEmpty(P256dh) || string.IsNullOrEmpty(Auth) || !WebPush.AreKeys(P256dh, Auth))
        {
            errors["keys"] = ["The browser's keys are not ones Wheelhouse can encrypt to."];
        }

        if (!ReminderSubscription.LeadChoices.Contains(LeadMinutes))
        {
            errors["leadMinutes"] = [$"Choose {string.Join(", ", ReminderSubscription.LeadChoices)} minutes."];
        }

        if (MemberIds is { Count: > 50 })
        {
            errors["memberIds"] = ["Choose at most 50 people."];
        }

        return errors;
    }
}

/// <summary>Names a browser's subscription by its endpoint, which only that browser knows.</summary>
public sealed record ReminderEndpointRequest(string Endpoint);

public sealed record ReminderResponse(int LeadMinutes, List<Guid> MemberIds)
{
    public static ReminderResponse From(ReminderSubscription subscription) => new(subscription.LeadMinutes, subscription.MemberIds);
}

public static class ReminderEndpoints
{
    public static IServiceCollection AddReminders(this IServiceCollection services)
    {
        services.AddOptions<ReminderOptions>().BindConfiguration(ReminderOptions.Section);
        services.AddSingleton<VapidKeys>();
        services.AddHttpClient<WebPush>(client => client.Timeout = TimeSpan.FromSeconds(10));
        services.AddScoped<ReminderSender>();
        services.AddHostedService<ReminderService>();
        return services;
    }

    /// <summary>
    /// A parent's browser, the demo visitor's included, turns reminders on and off for itself. A
    /// display shows the calendar to the room, so it is never reminded.
    /// </summary>
    public static IEndpointRouteBuilder MapReminders(this IEndpointRouteBuilder app)
    {
        var reminders = app.MapGroup("/api/reminders").RequireAuthorization(Policies.Parent);
        reminders.MapGet("key", Key);
        reminders.MapPut("", Save);
        reminders.MapPost("current", Current);
        reminders.MapPost("remove", Remove);
        reminders.MapPost("test", Test);
        return app;
    }

    private static async Task<Ok<PushKeyResponse>> Key(VapidKeys keys, CancellationToken cancellationToken) =>
        TypedResults.Ok(new PushKeyResponse((await keys.GetAsync(cancellationToken)).PublicKey));

    private static async Task<Results<Ok<ReminderResponse>, ValidationProblem>> Save(
        ReminderRequest request,
        HttpContext http,
        ICurrentFamily family,
        WheelhouseDbContext db,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var errors = request.Validate();
        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        var familyId = family.Id!.Value;
        var members = await db.Members.Where(m => m.FamilyId == familyId).Select(m => m.Id).ToListAsync(cancellationToken);
        var memberIds = (request.MemberIds ?? []).Distinct().Where(members.Contains).ToList();
        var now = time.GetUtcNow();

        // A browser has one subscription: one signed in to another family before moves here.
        var subscription = await db.ReminderSubscriptions.IgnoreQueryFilters()
            .SingleOrDefaultAsync(s => s.Endpoint == request.Endpoint, cancellationToken);
        if (subscription is not null && subscription.FamilyId != familyId)
        {
            db.ReminderSubscriptions.Remove(subscription);
            subscription = null;
        }

        if (subscription is null)
        {
            subscription = new ReminderSubscription
            {
                FamilyId = familyId,
                Endpoint = request.Endpoint,
                P256dh = request.P256dh,
                Auth = request.Auth,
                Site = "",
                CreatedAt = now,
            };
            db.ReminderSubscriptions.Add(subscription);
        }

        subscription.LeadMinutes = request.LeadMinutes;
        subscription.P256dh = request.P256dh;
        subscription.Auth = request.Auth;
        subscription.MemberIds = memberIds;
        subscription.AccountId = Guid.TryParse(http.User.FindFirstValue(WheelhouseClaims.Account), out var account) ? account : null;
        subscription.Site = Site(http.Request);
        await db.SaveChangesAsync(cancellationToken);

        return TypedResults.Ok(ReminderResponse.From(subscription));
    }

    private static async Task<Results<Ok<ReminderResponse>, NotFound>> Current(
        ReminderEndpointRequest request, WheelhouseDbContext db, CancellationToken cancellationToken) =>
        await db.ReminderSubscriptions.AsNoTracking().SingleOrDefaultAsync(s => s.Endpoint == request.Endpoint, cancellationToken) is { } subscription
            ? TypedResults.Ok(ReminderResponse.From(subscription))
            : TypedResults.NotFound();

    private static async Task<NoContent> Remove(ReminderEndpointRequest request, WheelhouseDbContext db, CancellationToken cancellationToken)
    {
        await db.ReminderSubscriptions.Where(s => s.Endpoint == request.Endpoint).ExecuteDeleteAsync(cancellationToken);
        return TypedResults.NoContent();
    }

    /// <summary>Sends one reminder now, so a parent can see that this phone shows them.</summary>
    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> Test(
        ReminderEndpointRequest request, WheelhouseDbContext db, WebPush push, CancellationToken cancellationToken)
    {
        if (await db.ReminderSubscriptions.SingleOrDefaultAsync(s => s.Endpoint == request.Endpoint, cancellationToken) is not { } subscription)
        {
            return TypedResults.NotFound();
        }

        var message = new ReminderMessage(
            "Reminders are on",
            $"This phone will hear about events {subscription.LeadMinutes} min before they start.",
            "/",
            "test");
        switch (await push.SendAsync(new PushTarget(subscription.Endpoint, subscription.P256dh, subscription.Auth), message, subscription.Site, cancellationToken))
        {
            case PushOutcome.Sent:
                return TypedResults.NoContent();
            case PushOutcome.Gone:
                db.ReminderSubscriptions.Remove(subscription);
                await db.SaveChangesAsync(cancellationToken);
                return TypedResults.NotFound();
            default:
                return TypedResults.Problem("The push service did not take the reminder. Try again in a moment.", statusCode: StatusCodes.Status502BadGateway);
        }
    }

    /// <summary>
    /// Who push services are told the reminders come from (VAPID's <c>sub</c>): the site, which must be
    /// an https address. Running locally over http, a placeholder stands in.
    /// </summary>
    private static string Site(HttpRequest request) =>
        request.IsHttps ? $"https://{request.Host}" : "mailto:reminders@wheelhouse.invalid";
}
