using System.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class AccessTests(ApiFactory factory)
{
    [Fact]
    public void Only_health_the_session_and_the_demo_visit_are_open()
    {
        var open = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Where(endpoint => endpoint.Metadata.GetMetadata<IAllowAnonymous>() is not null)
            .Select(endpoint => endpoint.RoutePattern.RawText);

        Assert.Equal(["/api/demo/visit", "/api/session", "/health"], open.Order());
    }

    [Fact]
    public async Task Anything_that_names_no_policy_still_needs_a_family_sign_in()
    {
        // No endpoint matches this path, so no policy is named for it: only the fallback applies.
        const string unnamed = "/api/nothing-here";
        using var stranger = factory.Demo.CreateClient();
        using var visitor = await factory.DemoVisitorAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, (await stranger.GetAsync(unnamed)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await visitor.GetAsync(unnamed)).StatusCode);
    }

    [Fact]
    public async Task The_sign_in_cookie_is_https_only_when_the_server_says_the_visitor_came_over_https()
    {
        // The server's nginx terminates HTTPS and says so in X-Forwarded-Proto.
        using var overHttps = factory.Demo.CreateClient();
        overHttps.DefaultRequestHeaders.Add("X-Forwarded-Proto", "https");
        using var overHttp = factory.Demo.CreateClient();

        var secure = await CookieAttributesAsync(overHttps);
        var plain = await CookieAttributesAsync(overHttp);

        Assert.Contains("secure", secure);
        Assert.Contains("httponly", secure);
        Assert.DoesNotContain("secure", plain);
    }

    private static async Task<string[]> CookieAttributesAsync(HttpClient client)
    {
        var visit = await client.PostAsync("/api/demo/visit", content: null);
        var cookie = Assert.Single(visit.Headers.GetValues("Set-Cookie"), value => value.StartsWith("wheelhouse="));
        return cookie.Split(';').Skip(1).Select(attribute => attribute.Trim().ToLowerInvariant()).ToArray();
    }
}
