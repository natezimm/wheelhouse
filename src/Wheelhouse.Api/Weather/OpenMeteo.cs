using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Http.Resilience;
using Polly;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Weather;

/// <summary>
/// Today's weather and the week's forecast from Open-Meteo, which is free for non-commercial use and needs no key
/// (https://open-meteo.com/en/docs). Calls are cached by <see cref="WeatherForecasts"/>.
/// </summary>
public sealed class OpenMeteo(HttpClient http)
{
    public const string BaseAddress = "https://api.open-meteo.com/";

    /// <summary>How many days the forecast covers, today first: a week on the wall.</summary>
    public const int Days = 7;

    /// <summary>
    /// The longest a screen waits on Open-Meteo, both attempts, the wait between them and the body
    /// together (the client's own timeout); a failure is then remembered by <see cref="WeatherForecasts"/>, so the next screen does not wait.
    /// </summary>
    public static readonly TimeSpan WaitAtMost = TimeSpan.FromSeconds(10);

    /// <summary>One attempt's time: long enough for <see cref="ConnectAsync"/> to move past a dead address.</summary>
    public static readonly TimeSpan AttemptTakesAtMost = TimeSpan.FromSeconds(6);

    /// <summary>
    /// One quick retry of a 5xx, 408, 429, dropped connection or timed-out attempt, inside
    /// <see cref="WaitAtMost"/>. A screen is waiting, so the retry neither waits long nor honours a
    /// Retry-After; the per-place failure memory spaces out anything longer. No circuit breaker for
    /// the same reason: that memory already stops a place asking while Open-Meteo is down.
    /// </summary>
    public static void Resilience(ResiliencePipelineBuilder<HttpResponseMessage> pipeline) => pipeline
        .AddRetry(new HttpRetryStrategyOptions
        {
            MaxRetryAttempts = 1,
            BackoffType = DelayBackoffType.Constant,
            Delay = TimeSpan.FromMilliseconds(300),
            UseJitter = true,
            ShouldRetryAfterHeader = false,
        })
        .AddTimeout(AttemptTakesAtMost);

    /// <summary>How long one of Open-Meteo's addresses gets to answer before the next is tried.</summary>
    public static readonly TimeSpan ConnectEach = TimeSpan.FromSeconds(3);

    /// <summary>
    /// Connects to Open-Meteo's IPv4 addresses first, each given <see cref="ConnectEach"/>, then its
    /// IPv6 ones. .NET otherwise tries addresses in the resolver's order and waits on each, so a host
    /// whose IPv6 route goes nowhere spends the client's whole timeout there. The demo's server timed
    /// out on every request while Open-Meteo answered elsewhere in a tenth of a second; a dead IPv6
    /// route is the likely cause, though not confirmed on the server itself.
    /// </summary>
    public static async ValueTask<Stream> ConnectAsync(SocketsHttpConnectionContext context, CancellationToken cancellationToken)
    {
        var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, cancellationToken);
        Exception? last = null;
        foreach (var address in addresses.OrderBy(address => address.AddressFamily == AddressFamily.InterNetwork ? 0 : 1))
        {
            var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            using var attempt = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            attempt.CancelAfter(ConnectEach);
            try
            {
                await socket.ConnectAsync(new IPEndPoint(address, context.DnsEndPoint.Port), attempt.Token);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch (Exception exception) when (exception is SocketException or OperationCanceledException && !cancellationToken.IsCancellationRequested)
            {
                socket.Dispose();
                last = exception;
            }
        }

        throw new HttpRequestException($"Could not connect to {context.DnsEndPoint.Host}.", last);
    }

    public async Task<Forecast> GetAsync(double latitude, double longitude, Units units, string timeZone, CancellationToken cancellationToken)
    {
        var query = string.Join('&',
            $"latitude={latitude.ToString(CultureInfo.InvariantCulture)}",
            $"longitude={longitude.ToString(CultureInfo.InvariantCulture)}",
            "current=temperature_2m,weather_code,is_day",
            "daily=temperature_2m_max,temperature_2m_min,weather_code",
            $"timezone={Uri.EscapeDataString(timeZone)}",
            $"forecast_days={Days}",
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
        [property: JsonPropertyName("temperature_2m_min")] double[] Low,
        [property: JsonPropertyName("time")] string[]? Dates = null,
        [property: JsonPropertyName("weather_code")] int[]? WeatherCodes = null);
}
