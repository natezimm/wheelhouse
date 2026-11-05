using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Wheelhouse.Api.Diagnostics;

namespace Wheelhouse.Api.Tests;

/// <summary>The one structured line each API request leaves in the log.</summary>
[Collection(ApiCollection.Name)]
public sealed class RequestLoggingTests(ApiFactory factory)
{
    [Fact]
    public async Task A_change_is_logged_with_its_status_family_and_route_but_never_its_query()
    {
        var logs = new Captured();
        await using var host = factory.Demo.WithWebHostBuilder(builder => builder.ConfigureLogging(logging => logging.AddProvider(logs)));
        using var visitor = host.CreateClient();
        (await visitor.PostAsync("/api/demo/visit", content: null)).EnsureSuccessStatusCode();

        var id = Guid.NewGuid();
        var response = await visitor.DeleteAsync($"/api/calendar/events/{id}?version=secret");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

        var line = Assert.Single(logs.Lines, l => l.Fields.GetValueOrDefault("Method") as string == "DELETE");
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.Equal($"/api/calendar/events/{id}", line.Fields["Path"]);
        Assert.Equal(404, line.Fields["StatusCode"]);
        Assert.Equal("/api/calendar/events/{id:guid}", line.Fields["Route"]);
        Assert.NotNull(line.Fields["FamilyId"]);
        Assert.DoesNotContain("secret", line.Message);
    }

    [Theory]
    [InlineData("GET", "/api/calendar", 200, 50, LogLevel.Debug)]
    [InlineData("GET", "/health", 200, 5, LogLevel.Debug)]
    [InlineData("PATCH", "/api/calendar/events/a", 200, 50, LogLevel.Information)]
    [InlineData("GET", "/api/calendar", 401, 5, LogLevel.Information)]
    [InlineData("GET", "/api/calendar", 200, 3000, LogLevel.Warning)]
    [InlineData("GET", "/hubs/calendar", 101, 3_600_000, LogLevel.Debug)]
    [InlineData("GET", "/api/weather", 503, 5, LogLevel.Warning)]
    [InlineData("POST", "/api/calendar/events", 500, 5, LogLevel.Error)]
    public void Routine_reads_stay_quiet_and_failures_stand_out(string method, string path, int status, int ms, LogLevel expected) =>
        Assert.Equal(expected, RequestLogging.LevelFor(method, path, status, TimeSpan.FromMilliseconds(ms)));

    private sealed record Line(LogLevel Level, string Message, IReadOnlyDictionary<string, object?> Fields);

    private sealed class Captured : ILoggerProvider
    {
        public ConcurrentQueue<Line> Queue { get; } = new();

        public IEnumerable<Line> Lines => Queue.ToArray();

        public ILogger CreateLogger(string categoryName) => categoryName == RequestLogging.Category ? new Logger(Queue) : NullLogger.Instance;

        public void Dispose()
        {
        }

        private sealed class Logger(ConcurrentQueue<Line> queue) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
                queue.Enqueue(new Line(
                    logLevel,
                    formatter(state, exception),
                    state is IEnumerable<KeyValuePair<string, object?>> fields ? fields.ToDictionary(f => f.Key, f => f.Value) : []));
        }

        private sealed class NullLogger : ILogger
        {
            public static readonly NullLogger Instance = new();

            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => false;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
            }
        }
    }
}
