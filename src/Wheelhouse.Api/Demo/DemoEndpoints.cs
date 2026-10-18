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

        if (await copies.CreateAsync(cancellationToken) is not { } familyId)
        {
            return TypedResults.Problem(
                "The demo is full right now. Try again later.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        await calendar.DisconnectAsync(http.User);
        await http.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            WheelhousePrincipal.Parent(familyId),
            new AuthenticationProperties { IsPersistent = true, ExpiresUtc = time.GetUtcNow() + DemoCopies.Lifetime });

        return TypedResults.NoContent();
    }
}
