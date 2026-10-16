using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Weather;

public static class WeatherEndpoints
{
    public static IServiceCollection AddWeather(this IServiceCollection services)
    {
        services.AddMemoryCache();
        services.AddHttpClient<OpenMeteo>(client =>
        {
            client.BaseAddress = new Uri(OpenMeteo.BaseAddress);
            client.Timeout = TimeSpan.FromSeconds(10);
        });
        services.AddScoped<WeatherForecasts>();
        return services;
    }

    /// <summary>Anyone in the family can read the weather, the wall included.</summary>
    public static IEndpointRouteBuilder MapWeather(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/weather", GetWeather).RequireAuthorization(Policies.Family);

        return app;
    }

    /// <summary>
    /// Today's weather where the family lives. No content until a parent sets the place, and 503
    /// when Open-Meteo cannot be reached, so the screens simply leave the weather out.
    /// </summary>
    private static async Task<Results<Ok<WeatherResponse>, NoContent, NotFound, StatusCodeHttpResult>> GetWeather(
        WheelhouseDbContext db,
        WeatherForecasts forecasts,
        ILogger<WeatherForecasts> logger,
        CancellationToken cancellationToken)
    {
        var family = await db.Families.AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        if (family is null)
        {
            return TypedResults.NotFound();
        }

        if (family.Latitude is null || family.Longitude is null)
        {
            return TypedResults.NoContent();
        }

        try
        {
            return TypedResults.Ok(await forecasts.GetAsync(family, cancellationToken));
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            logger.LogWarning(exception, "Open-Meteo could not be reached for the weather.");
            return TypedResults.StatusCode(StatusCodes.Status503ServiceUnavailable);
        }
    }
}
