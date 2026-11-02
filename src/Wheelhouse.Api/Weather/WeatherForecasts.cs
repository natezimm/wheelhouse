using Microsoft.Extensions.Caching.Memory;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Weather;

/// <summary>
/// Today's weather and the week's forecast for a place, asked of Open-Meteo at most once every 30 minutes per place. The
/// demo's visitors all share the Marlowes' city, so they share one cached forecast too.
/// </summary>
public sealed class WeatherForecasts(OpenMeteo openMeteo, IMemoryCache cache)
{
    public static readonly TimeSpan KeepFor = TimeSpan.FromMinutes(30);

    /// <summary>
    /// How long a failure to reach Open-Meteo is remembered for a place. Each screen asks on every
    /// load, and without this each held a request open for the client's whole timeout.
    /// </summary>
    public static readonly TimeSpan FailureKeptFor = TimeSpan.FromMinutes(2);

    /// <summary>Open-Meteo failed for this place moments ago, so it is not asked again yet.</summary>
    public sealed class RecentlyFailedException() : Exception("Open-Meteo failed for this place moments ago.");

    public async Task<WeatherResponse> GetAsync(Family family, CancellationToken cancellationToken)
    {
        // About a kilometer apart is the same place.
        var latitude = Math.Round(family.Latitude!.Value, 2);
        var longitude = Math.Round(family.Longitude!.Value, 2);
        var key = (nameof(WeatherForecasts), latitude, longitude, family.Units, family.TimeZone);

        if (cache.TryGetValue(key, out WeatherResponse? cached))
        {
            return cached!;
        }

        var failedKey = (key, "failed");
        if (cache.TryGetValue(failedKey, out _))
        {
            throw new RecentlyFailedException();
        }

        OpenMeteo.Forecast forecast;
        try
        {
            forecast = await openMeteo.GetAsync(latitude, longitude, family.Units, family.TimeZone, cancellationToken);
        }
        catch (Exception exception) when (!cancellationToken.IsCancellationRequested
            && exception is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            cache.Set(failedKey, true, FailureKeptFor);
            throw;
        }

        var (description, icon) = Describe(forecast.Current.WeatherCode, forecast.Current.IsDay == 1);
        var weather = new WeatherResponse(
            (int)Math.Round(forecast.Current.Temperature),
            description,
            icon,
            (int)Math.Round(forecast.Daily.High[0]),
            (int)Math.Round(forecast.Daily.Low[0]),
            family.Units == Units.Metric ? "C" : "F",
            DaysOf(forecast.Daily));

        return cache.Set(key, weather, KeepFor);
    }

    /// <summary>Each day of the forecast, today first, with its daytime icon; none when Open-Meteo sent no dates.</summary>
    private static IReadOnlyList<ForecastDay> DaysOf(OpenMeteo.Daily daily)
    {
        if (daily.Dates is not { } dates || daily.WeatherCodes is not { } codes)
        {
            return [];
        }

        var count = new[] { dates.Length, codes.Length, daily.High.Length, daily.Low.Length }.Min();
        return Enumerable.Range(0, count).Select(i =>
        {
            var (description, icon) = Describe(codes[i], isDay: true);
            return new ForecastDay(DateOnly.ParseExact(dates[i], "yyyy-MM-dd"), description, icon,
                (int)Math.Round(daily.High[i]), (int)Math.Round(daily.Low[i]));
        }).ToList();
    }

    /// <summary>Words and an icon for a WMO weather code, as Open-Meteo reports it.</summary>
    public static (string Description, WeatherIcon Icon) Describe(int code, bool isDay) => code switch
    {
        0 => ("Clear", isDay ? WeatherIcon.Sun : WeatherIcon.Moon),
        1 => ("Mostly clear", isDay ? WeatherIcon.Sun : WeatherIcon.Moon),
        2 => ("Partly cloudy", WeatherIcon.PartlyCloudy),
        3 => ("Cloudy", WeatherIcon.Cloud),
        45 or 48 => ("Fog", WeatherIcon.Fog),
        >= 51 and <= 57 => ("Drizzle", WeatherIcon.Rain),
        >= 61 and <= 67 => ("Rain", WeatherIcon.Rain),
        >= 71 and <= 77 => ("Snow", WeatherIcon.Snow),
        >= 80 and <= 82 => ("Showers", WeatherIcon.Rain),
        85 or 86 => ("Snow showers", WeatherIcon.Snow),
        >= 95 => ("Thunderstorms", WeatherIcon.Storm),
        _ => ("Cloudy", WeatherIcon.Cloud),
    };
}

public enum WeatherIcon
{
    Sun,
    Moon,
    PartlyCloudy,
    Cloud,
    Fog,
    Rain,
    Snow,
    Storm,
}

/// <summary>
/// Today's weather where the family lives, in its own units, and the forecast for the coming
/// week by the family's days, today first.
/// </summary>
public sealed record WeatherResponse(int Temperature, string Description, WeatherIcon Icon, int High, int Low, string Unit,
    IReadOnlyList<ForecastDay>? Days = null);

/// <summary>One day of the forecast: its weather in words and an icon, and its high and low.</summary>
public sealed record ForecastDay(DateOnly Date, string Description, WeatherIcon Icon, int High, int Low);
