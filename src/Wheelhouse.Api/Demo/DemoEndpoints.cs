using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Instance;
using Wheelhouse.Api.Calendar;

namespace Wheelhouse.Api.Demo;

public static class DemoEndpoints
{
    /// <summary>New copies per address. Requests with no address, such as the tests', are not limited.</summary>
    private static readonly PartitionedRateLimiter<string> NewCopies = PartitionedRateLimiter.Create<string, string>(address =>
        address.Length == 0
            ? RateLimitPartition.GetNoLimiter(address)
            : RateLimitPartition.GetFixedWindowLimiter(address, _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 20,
                Window = TimeSpan.FromHours(1),
            }));

    public static IEndpointRouteBuilder MapDemo(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/demo/visit", Visit).AllowAnonymous();
        return app;
    }

    /// <summary>
    /// The web app calls this once on every load of a demo instance. A new visitor gets a
    /// private copy of the demo family and is signed in to it as a parent; a returning visitor
    /// keeps the copy they have. This is the only way anyone is signed in without an account,
    /// and it does not exist on a family instance.
    /// </summary>
    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> Visit(
        HttpContext http,
        DemoCopies copies,
        ICurrentFamily current,
        IOptions<InstanceOptions> instance,
        TimeProvider time,
        CalendarConnections calendar,
        CancellationToken cancellationToken)
    {
        if (instance.Value.Mode != InstanceMode.Demo)
        {
            return TypedResults.NotFound();
        }

        if (current.Id is { } existing && await copies.ExistsAsync(existing, cancellationToken))
        {
            return TypedResults.NoContent();
        }

        // A returning visitor costs nothing, but each new copy is a family's worth of rows, so one
        // address cannot fill the demo for everyone else.
        using var lease = NewCopies.AttemptAcquire(http.Connection.RemoteIpAddress?.ToString() ?? "");
        if (!lease.IsAcquired)
        {
            return TypedResults.Problem(
                "Too many new demo visits from your network. Try again later.",
                statusCode: StatusCodes.Status429TooManyRequests);
        }

        var familyId = await copies.CreateAsync(cancellationToken);

        await calendar.DisconnectAsync(http.User);
        await http.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            WheelhousePrincipal.Parent(familyId),
            new AuthenticationProperties { IsPersistent = true, ExpiresUtc = time.GetUtcNow() + DemoCopies.Lifetime });

        return TypedResults.NoContent();
    }
}
