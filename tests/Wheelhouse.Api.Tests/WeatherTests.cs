using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Weather;

namespace Wheelhouse.Api.Tests;

/// <summary>
/// Each test gets a demo host of its own whose Open-Meteo is a fake, so no test calls the real
/// service and each starts with an empty forecast cache.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class WeatherTests(ApiFactory factory)
{
    private const string PartlyCloudy = """
        {
          "current": { "temperature_2m": 61.4, "weather_code": 2, "is_day": 1 },
          "daily": { "temperature_2m_max": [66.2], "temperature_2m_min": [47.6] }
        }
        """;

    [Fact]
    public async Task The_family_sees_todays_weather_where_it_lives_in_its_own_units()
    {
        var openMeteo = new FakeOpenMeteo(HttpStatusCode.OK, PartlyCloudy);
        using var visitor = await VisitorAsync(openMeteo);

        var weather = await visitor.GetFromJsonAsync<WeatherResponse>("/api/weather", ApiFactory.Json);

        Assert.Equal(new WeatherResponse(61, "Partly cloudy", WeatherIcon.PartlyCloudy, 66, 48, "F"), weather);
        var asked = Assert.Single(openMeteo.Requests);
        Assert.Contains("latitude=40.71", asked.Query);
        Assert.Contains("longitude=-74.01", asked.Query);
        Assert.Contains("temperature_unit=fahrenheit", asked.Query);
        Assert.Contains("timezone=America%2FNew_York", asked.Query);
    }

    [Fact]
    public async Task A_forecast_is_asked_for_once_and_kept_for_half_an_hour()
    {
        var openMeteo = new FakeOpenMeteo(HttpStatusCode.OK, PartlyCloudy);
        using var visitor = await VisitorAsync(openMeteo);

        (await visitor.GetAsync("/api/weather")).EnsureSuccessStatusCode();
        (await visitor.GetAsync("/api/weather")).EnsureSuccessStatusCode();

        Assert.Single(openMeteo.Requests);
    }

    [Fact]
    public async Task There_is_no_weather_until_a_parent_says_where_the_family_lives()
    {
        var openMeteo = new FakeOpenMeteo(HttpStatusCode.OK, PartlyCloudy);
        using var visitor = await VisitorAsync(openMeteo);

        var cleared = await visitor.PutAsJsonAsync("/api/family/location", new FamilyLocationRequest(null, null), ApiFactory.Json);
        var response = await visitor.GetAsync("/api/weather");

        cleared.EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(openMeteo.Requests);
    }

    [Fact]
    public async Task Weather_is_unavailable_rather_than_an_error_when_open_meteo_is_down()
    {
        using var visitor = await VisitorAsync(new FakeOpenMeteo(HttpStatusCode.BadGateway, ""));

        var response = await visitor.GetAsync("/api/weather");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task A_parent_sets_the_place_to_about_a_kilometre()
    {
        using var visitor = await factory.DemoVisitorAsync();

        var response = await visitor.PutAsJsonAsync("/api/family/location", new FamilyLocationRequest(47.606209, -122.332069), ApiFactory.Json);

        var family = await response.Content.ReadFromJsonAsync<FamilyResponse>(ApiFactory.Json);
        Assert.Equal(47.61, family!.Latitude);
        Assert.Equal(-122.33, family.Longitude);
    }

    [Theory]
    [InlineData(91.0, 0.0, "latitude")]
    [InlineData(0.0, -181.0, "longitude")]
    [InlineData(40.0, null, "latitude")]
    public async Task A_place_off_the_map_is_refused(double? latitude, double? longitude, string field)
    {
        using var visitor = await factory.DemoVisitorAsync();

        var response = await visitor.PutAsJsonAsync("/api/family/location", new FamilyLocationRequest(latitude, longitude), ApiFactory.Json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(field, problem!.Errors.Keys);
    }

    private async Task<HttpClient> VisitorAsync(FakeOpenMeteo openMeteo)
    {
        var host = factory.Demo.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddHttpClient<OpenMeteo>().ConfigurePrimaryHttpMessageHandler(() => openMeteo)));
        var client = host.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        (await client.PostAsync("/api/demo/visit", content: null)).EnsureSuccessStatusCode();
        return client;
    }

    private sealed class FakeOpenMeteo(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public List<Uri> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request.RequestUri!);
            return Task.FromResult(new HttpResponseMessage(status)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            });
        }
    }
}
