using Microsoft.Extensions.Options;

namespace Wheelhouse.Api.Instance;

public static class RobotsEndpoints
{
    /// <summary>
    /// Maps <c>/robots.txt</c>, which the web container forwards here because only the API knows
    /// the instance's mode. A family instance asks every crawler to stay out, so its address never
    /// lands in search results; the demo lets them read the app and keeps them off the API and
    /// the live-update hub. Without this, the app shell answered for robots.txt, which crawlers
    /// read as a page of invalid rules.
    /// </summary>
    public static IEndpointRouteBuilder MapRobots(this IEndpointRouteBuilder app)
    {
        app.MapGet("/robots.txt", (IOptions<InstanceOptions> instance) => Results.Text(
                instance.Value.Mode == InstanceMode.Demo ? Demo : Family, "text/plain; charset=utf-8"))
            .AllowAnonymous();
        return app;
    }

    internal const string Family = """
        # A family's private calendar: nothing here is for search engines.
        User-agent: *
        Disallow: /

        """;

    internal const string Demo = """
        # The public demo of Wheelhouse, a family calendar.
        User-agent: *
        Disallow: /api/
        Disallow: /hubs/
        Allow: /

        """;
}
