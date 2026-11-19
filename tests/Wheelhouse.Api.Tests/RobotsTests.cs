namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class RobotsTests(ApiFactory factory)
{
    [Fact]
    public async Task A_family_instance_asks_every_crawler_to_stay_out()
    {
        using var stranger = factory.CreateClient();

        var response = await stranger.GetAsync("/robots.txt");

        response.EnsureSuccessStatusCode();
        Assert.Equal("text/plain", response.Content.Headers.ContentType?.MediaType);
        var lines = (await response.Content.ReadAsStringAsync()).Split('\n', StringSplitOptions.TrimEntries);
        Assert.Contains("User-agent: *", lines);
        Assert.Contains("Disallow: /", lines);
        Assert.Equal(System.Net.HttpStatusCode.NotFound, (await stranger.GetAsync("/sitemap.xml")).StatusCode);
    }

    [Fact]
    public async Task The_demo_lets_crawlers_read_the_app_but_not_the_api()
    {
        using var stranger = factory.Demo.CreateClient();

        var lines = (await stranger.GetStringAsync("/robots.txt")).Split('\n', StringSplitOptions.TrimEntries);

        Assert.DoesNotContain("Disallow: /", lines);
        Assert.Contains("Disallow: /api/", lines);
        Assert.Contains("Allow: /", lines);
        Assert.Contains("Sitemap: https://calendar.nathanzimmerman.com/sitemap.xml", lines);

        using var sitemap = await stranger.GetAsync("/sitemap.xml");
        sitemap.EnsureSuccessStatusCode();
        Assert.Equal("application/xml", sitemap.Content.Headers.ContentType?.MediaType);
        var xml = System.Xml.Linq.XElement.Parse(await sitemap.Content.ReadAsStringAsync());
        System.Xml.Linq.XNamespace ns = "http://www.sitemaps.org/schemas/sitemap/0.9";
        Assert.Equal("https://calendar.nathanzimmerman.com/", Assert.Single(xml.Elements(ns + "url")).Element(ns + "loc")?.Value);
    }
}
