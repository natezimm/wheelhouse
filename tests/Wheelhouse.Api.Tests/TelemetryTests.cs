using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using OpenTelemetry.Trace;
using Wheelhouse.Api.Diagnostics;

namespace Wheelhouse.Api.Tests;

public sealed class TelemetryTests
{
    [Fact]
    public void Telemetry_registers_nothing_without_an_OTLP_endpoint()
    {
        var builder = WebApplication.CreateBuilder();

        Assert.False(builder.AddTelemetry(endpoint: " "));
        using var app = builder.Build();
        Assert.Null(app.Services.GetService<TracerProvider>());
    }

    [Fact]
    public void Telemetry_builds_its_providers_when_an_OTLP_endpoint_is_set()
    {
        var builder = WebApplication.CreateBuilder();
        builder.Configuration["Telemetry:TraceSampleRatio"] = "1";

        Assert.True(builder.AddTelemetry(endpoint: "http://localhost:4318"));
        using var app = builder.Build();
        Assert.NotNull(app.Services.GetService<TracerProvider>());
    }

    [Theory]
    [InlineData("wall", "wall")]
    [InlineData("phone", "phone")]
    [InlineData("desktop", "desktop")]
    [InlineData("kiosk-of-my-own", "other")]
    [InlineData(null, "other")]
    public void A_client_error_is_counted_under_one_of_three_layouts(string? sent, string counted) =>
        Assert.Equal(counted, ClientErrorEndpoints.Layout(sent));
}
