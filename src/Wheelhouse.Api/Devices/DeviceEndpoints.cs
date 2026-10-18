using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Household;

namespace Wheelhouse.Api.Devices;

public static class DeviceEndpoints
{
    private const string StartLimit = "pairing-start";
    private const string ClaimLimit = "pairing-claim";

    /// <summary>
    /// Anyone can ask for a code, so codes are limited per address; a parent's guesses at a
    /// code are limited per family, so nobody can try all million of them.
    /// </summary>
    public static IServiceCollection AddPairing(this IServiceCollection services)
    {
        services.AddScoped<Pairing>();
        services.AddScoped<DeviceCheckIn>();

        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(StartLimit, http => http.Connection.RemoteIpAddress is { } address
                ? RateLimitPartition.GetFixedWindowLimiter(address.ToString(), _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = 10,
                    Window = TimeSpan.FromMinutes(10),
                })
                : RateLimitPartition.GetNoLimiter(""));
            options.AddPolicy(ClaimLimit, http => RateLimitPartition.GetFixedWindowLimiter(
                http.User.FindFirstValue(WheelhouseClaims.Family) ?? "",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
        });

        return services;
    }

    public static IEndpointRouteBuilder MapDevices(this IEndpointRouteBuilder app)
    {
        // The display's side. It is not signed in to a family yet, so these are open.
        var pairing = app.MapGroup("/api/pairing");
        pairing.MapPost("", Start).AllowAnonymous().RequireRateLimiting(StartLimit);
        pairing.MapPost("{id:guid}/finish", Finish).AllowAnonymous();

        // The phone's side, under Settings: only a parent pairs or removes a display.
        var devices = app.MapGroup("/api/devices").RequireAuthorization(Policies.Parent);
        devices.MapGet("", List);
        devices.MapPost("", Pair).RequireRateLimiting(ClaimLimit);
        devices.MapDelete("{id:guid}", Remove);

        return app;
    }

    private static async Task<Results<Ok<PairingResponse>, ProblemHttpResult>> Start(
        Pairing pairing,
        CancellationToken cancellationToken)
    {
        if (await pairing.StartAsync(cancellationToken) is not { } code)
        {
            return TypedResults.Problem(
                "Too many displays are pairing right now. Try again later.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        return TypedResults.Ok(new PairingResponse(code.Id, code.Code, code.ExpiresAt));
    }

    /// <summary>
    /// Asked by the display while it shows its code: 202 while it waits, 404 once the code has
    /// expired, and 204 with the display's sign-in once a parent has entered the code.
    /// </summary>
    private static async Task<Results<Accepted, NoContent, NotFound>> Finish(
        Guid id,
        HttpContext http,
        Pairing pairing,
        TimeProvider time,
        CalendarConnections calendar,
        HouseholdConnections household,
        CancellationToken cancellationToken)
    {
        switch (await pairing.FinishAsync(id, cancellationToken))
        {
            case PairingOutcome.Waiting:
                return TypedResults.Accepted((string?)null);
            case PairingOutcome.Paired(var device):
                // An already signed-in demo wall is leaving its old copy, or a wall is
                // pairing again. Its existing socket must not stay in the old family group.
                await calendar.DisconnectAsync(http.User);
                await household.DisconnectAsync(http.User);
                await http.SignInAsync(
                    CookieAuthenticationDefaults.AuthenticationScheme,
                    WheelhousePrincipal.Device(device.FamilyId, device.Id),
                    new AuthenticationProperties { IsPersistent = true, ExpiresUtc = time.GetUtcNow() + Device.SignInLifetime });
                return TypedResults.NoContent();
            default:
                return TypedResults.NotFound();
        }
    }

    // Below, the query filter has already limited the rows to the parent's own family.

    private static async Task<Ok<List<DeviceResponse>>> List(WheelhouseDbContext db, CancellationToken cancellationToken)
    {
        var devices = await db.Devices.AsNoTracking().OrderBy(d => d.PairedAt).ToListAsync(cancellationToken);
        return TypedResults.Ok(devices.Select(DeviceResponse.From).ToList());
    }

    private static async Task<Results<Created<DeviceResponse>, ValidationProblem>> Pair(
        PairDisplayRequest request,
        ICurrentFamily family,
        Pairing pairing,
        CancellationToken cancellationToken)
    {
        var errors = request.Validate();
        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        var device = await pairing.ClaimAsync(family.Id!.Value, request.Digits, request.Name.Trim(), cancellationToken);
        if (device is null)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["code"] = ["No display is showing that code. Check the code on the display, or wait for a new one."],
            });
        }

        return TypedResults.Created($"/api/devices/{device.Id}", DeviceResponse.From(device));
    }

    private static async Task<Results<NoContent, NotFound>> Remove(Guid id, WheelhouseDbContext db, CalendarConnections calendar,
        HouseholdConnections household, CancellationToken cancellationToken)
    {
        // The display's cookie is checked against this row on every request, so it is signed out at once.
        var removed = await db.Devices.Where(d => d.Id == id).ExecuteDeleteAsync(cancellationToken);
        if (removed > 0)
        {
            await calendar.DisconnectDeviceAsync(id);
            await household.DisconnectDeviceAsync(id);
        }
        return removed == 0 ? TypedResults.NotFound() : TypedResults.NoContent();
    }
}

