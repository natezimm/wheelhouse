using System.Globalization;
using System.Text.Json.Serialization;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Weather;

/// <summary>
/// Today's weather from Open-Meteo, which is free for non-commercial use and needs no key
/// (https://open-meteo.com/en/docs). Calls are cached by <see cref="WeatherForecasts"/>.
/// </summary>
public sealed class OpenMeteo(HttpClient http)
{
    public const string BaseAddress = "https://api.open-meteo.com/";

    public async Task<Forecast> GetAsync(double latitude, double longitude, Units units, string timeZone, CancellationToken cancellationToken)
    {
        var query = string.Join('&',
            $"latitude={latitude.ToString(CultureInfo.InvariantCulture)}",
            $"longitude={longitude.ToString(CultureInfo.InvariantCulture)}",
            "current=temperature_2m,weather_code,is_day",
            "daily=temperature_2m_max,temperature_2m_min",
            $"timezone={Uri.EscapeDataString(timeZone)}",
            "forecast_days=1",
            $"temperature_unit={(units == Units.Metric ? "celsius" : "fahrenheit")}");

        var forecast = await http.GetFromJsonAsync<Forecast>($"v1/forecast?{query}", cancellationToken);
        return forecast ?? throw new HttpRequestException("Open-Meteo sent an empty forecast.");
    }

    public sealed record Forecast(Current Current, Daily Daily);

    public sealed record Current(
        [property: JsonPropertyName("temperature_2m")] double Temperature,
        [property: JsonPropertyName("weather_code")] int WeatherCode,
        [property: JsonPropertyName("is_day")] int IsDay);

    public sealed record Daily(
        [property: JsonPropertyName("temperature_2m_max")] double[] High,
        [property: JsonPropertyName("temperature_2m_min")] double[] Low);
}
