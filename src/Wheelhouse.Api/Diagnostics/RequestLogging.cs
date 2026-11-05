using System.Diagnostics;
using System.Security.Claims;
using Wheelhouse.Api.Auth;

namespace Wheelhouse.Api.Diagnostics;

/// <summary>
/// One structured log line per API request: method, path (never the query string, which can hold
/// a search), the endpoint's route, status, time taken, and whose request it was by family and
/// device or account ids, never names or addresses. In a deployed instance the console writes
/// these as JSON (appsettings.json), each carrying the request's id and trace id so the lines one
/// request wrote can be found together.
///
/// Successful reads are routine (every screen reads the calendar again every 30 seconds), so they
/// are logged at Debug and dropped unless <c>Logging:LogLevel:Wheelhouse.Requests</c> says Debug.
/// Changes and refusals are Information, slow requests Warning and server errors Error.
/// </summary>
public static class RequestLogging
{
    public const string Category = "Wheelhouse.Requests";

    /// <summary>A request taking longer than this is logged as a warning.</summary>
    public static readonly TimeSpan SlowAfter = TimeSpan.FromSeconds(2);

    public static IApplicationBuilder UseRequestLogging(this IApplicationBuilder app)
    {
        var logger = app.ApplicationServices.GetRequiredService<ILoggerFactory>().CreateLogger(Category);
        return app.Use(async (context, next) =>
        {
            var started = Stopwatch.GetTimestamp();
            try
            {
                await next(context);
            }
            catch
            {
                // The server logs the exception itself, with its stack; this line keeps the request's own record.
                Write(logger, context, StatusCodes.Status500InternalServerError, Stopwatch.GetElapsedTime(started));
                throw;
            }

            Write(logger, context, context.Response.StatusCode, Stopwatch.GetElapsedTime(started));
        });
    }

    public static LogLevel LevelFor(string method, string path, int status, TimeSpan elapsed)
    {
        if (status >= 500)
        {
            return status == StatusCodes.Status503ServiceUnavailable ? LogLevel.Warning : LogLevel.Error;
        }

        // A live subscription stays open for as long as the screen does, so its length means nothing.
        if (path.StartsWith("/hubs", StringComparison.OrdinalIgnoreCase))
        {
            return LogLevel.Debug;
        }

        if (elapsed > SlowAfter)
        {
            return LogLevel.Warning;
        }

        return status >= 400 || !(HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method))
            ? LogLevel.Information
            : LogLevel.Debug;
    }

    private static void Write(ILogger logger, HttpContext context, int status, TimeSpan elapsed)
    {
        var request = context.Request;
        var level = LevelFor(request.Method, request.Path, status, elapsed);
        if (!logger.IsEnabled(level))
        {
            return;
        }

        logger.Log(
            level,
            "{Method} {Path} answered {StatusCode} in {ElapsedMs} ms for family {FamilyId}, {Who} (route {Route})",
            request.Method,
            request.Path.Value,
            status,
            Math.Round(elapsed.TotalMilliseconds, 1),
            context.User.FindFirstValue(WheelhouseClaims.Family),
            ClientErrorEndpoints.Who(context.User),
            (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText);
    }
}
