using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class AccessTests(ApiFactory factory)
{
    [Fact]
    public void Only_health_the_session_the_demo_visit_google_sign_in_and_a_displays_pairing_are_open()
    {
        var open = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Where(endpoint => endpoint.Metadata.GetMetadata<IAllowAnonymous>() is not null)
            .Select(endpoint => endpoint.RoutePattern.RawText);

        Assert.Equal(
            ["/api/auth/google", "/api/demo/visit", "/api/pairing/", "/api/pairing/{id:guid}/finish", "/api/session", "/health"],
            open.Order());
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
    public async Task A_browser_on_another_origin_cannot_make_changes_even_with_the_cookie()
    {
        using var visitor = await factory.DemoVisitorAsync();
        HttpRequestMessage SetTheme(string? origin)
        {
            var request = new HttpRequestMessage(HttpMethod.Put, "/api/family/theme")
            {
                Content = JsonContent.Create(new FamilyThemeRequest(Theme.Groovy, NightMode.Off), options: ApiFactory.Json),
            };
            if (origin is not null)
            {
                request.Headers.TryAddWithoutValidation("Origin", origin);
            }
            return request;
        }

        // A sibling subdomain is the same site to SameSite=Lax, so the browser sends the cookie.
        foreach (var origin in new[] { "http://calendar.localhost", "https://unrelated.example", "null" })
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await visitor.SendAsync(SetTheme(origin))).StatusCode);
        }
        using var foreignRead = new HttpRequestMessage(HttpMethod.Get, "/api/family");
        foreignRead.Headers.Add("Origin", "https://unrelated.example");
        Assert.Equal(HttpStatusCode.OK, (await visitor.SendAsync(foreignRead)).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await visitor.SendAsync(SetTheme("http://localhost"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await visitor.SendAsync(SetTheme(null))).StatusCode);
    }

    [Fact]
    public async Task The_sign_in_cookie_is_https_only_when_the_server_says_the_visitor_came_over_https()
    {
        // As in production: the server's nginx terminates HTTPS and says so in X-Forwarded-Proto,
        // and the request reaches the API from the web container's address on the Compose network.
        var overHttps = await factory.Demo.Server.SendAsync(context =>
        {
            context.Request.Method = HttpMethods.Post;
            context.Request.Path = "/api/demo/visit";
            context.Request.Headers["X-Forwarded-Proto"] = "https";
            context.Request.Headers["X-Forwarded-For"] = "203.0.113.7";
            context.Connection.RemoteIpAddress = IPAddress.Parse("172.18.0.3");
        });
        using var overHttp = factory.Demo.CreateClient();
        var plain = await overHttp.PostAsync("/api/demo/visit", content: null);

        var secure = CookieAttributes(overHttps.Response.Headers.SetCookie);
        var plainAttributes = CookieAttributes(plain.Headers.GetValues("Set-Cookie"));

        Assert.Contains("secure", secure);
        Assert.Contains("httponly", secure);
        Assert.DoesNotContain("secure", plainAttributes);
    }

    private static string[] CookieAttributes(IEnumerable<string?> setCookie)
    {
        var cookie = Assert.Single(setCookie, value => value!.StartsWith("wheelhouse="))!;
        return cookie.Split(';').Skip(1).Select(attribute => attribute.Trim().ToLowerInvariant()).ToArray();
    }
}
