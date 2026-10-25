using Wheelhouse.Api.Calendar;

namespace Wheelhouse.Api.Auth;

public static class SameOrigin
{
    /// <summary>
    /// Cookie-authenticated WebSockets need an Origin check in addition to HTTP CORS. So do
    /// changes: the demo, the family instance and other sites can share a registrable domain,
    /// which SameSite=Lax treats as one site, so its cookie alone does not stop a sibling
    /// subdomain posting to this one.
    /// </summary>
    public static IApplicationBuilder UseSameOrigin(this IApplicationBuilder app) => app.Use(async (http, next) =>
    {
        var checkedRequest = http.Request.Path.StartsWithSegments(CalendarHub.Path)
            || !(HttpMethods.IsGet(http.Request.Method) || HttpMethods.IsHead(http.Request.Method) || HttpMethods.IsOptions(http.Request.Method));
        if (checkedRequest && http.Request.Headers.Origin.Count > 0)
        {
            var origins = http.Request.Headers.Origin;
            if (origins.Count != 1
                || !Uri.TryCreate(origins[0], UriKind.Absolute, out var origin)
                || origin.PathAndQuery != "/" || origin.Fragment.Length > 0 || origin.UserInfo.Length > 0
                || !Uri.TryCreate($"{http.Request.Scheme}://{http.Request.Host}", UriKind.Absolute, out var site)
                || !string.Equals(origin.GetLeftPart(UriPartial.Authority), site.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase))
            {
                http.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            }
        }

        // Nonbrowser clients may omit Origin; they still need the authenticated family cookie.
        await next(http);
    });
}
