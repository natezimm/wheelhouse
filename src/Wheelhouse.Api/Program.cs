using System.Text.Json.Serialization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Chores;
using Wheelhouse.Api.Lists;
using Wheelhouse.Api.Meals;
using Wheelhouse.Api.Household;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Demo;
using Wheelhouse.Api.Devices;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Health;
using Wheelhouse.Api.Instance;
using Wheelhouse.Api.Sessions;
using Wheelhouse.Api.Weather;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOptions<InstanceOptions>().BindConfiguration(InstanceOptions.Section);

// Read the connection string when the context is first built, not here, so configuration
// added after this line (the integration tests' database) is the one that gets used.
builder.Services.AddDbContext<WheelhouseDbContext>((services, options) =>
    options.UseNpgsql(services.GetRequiredService<IConfiguration>().GetConnectionString("Wheelhouse")));

builder.Services.AddHealthChecks()
    .AddDbContextCheck<WheelhouseDbContext>("database")
    .AddCheck<CalendarSyncHealth>("calendar");

// Requests reach the API through the server's nginx, which terminates HTTPS, then the web
// container's. Take the visitor's scheme and address from the X-Forwarded headers the server's
// nginx sets, so the API knows a request came over HTTPS. Only the web container can reach the
// API, so whichever proxy sent the request is trusted.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

builder.Services.AddWheelhouseAuth();
builder.Services.AddPairing();
builder.Services.AddWeather();
builder.Services.AddGoogleCalendar();
builder.Services.AddCalendarLive();
builder.Services.AddHouseholdLive();

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<DemoCopies>();
builder.Services.AddHostedService<DemoCleanupService>();

// Enums travel as their names ("Parent", "Demo"), which the web app's types mirror.
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

var app = builder.Build();

await app.PrepareDatabaseAsync();

app.UseForwardedHeaders();
app.UseCalendarHubOrigin();
app.UseHouseholdHubOrigin();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapHealth();
app.MapSession();
app.MapAuth();
app.MapDemo();
app.MapFamily();
app.MapDevices();
app.MapCalendar();
app.MapCalendarLive();
app.MapHouseholdLive();
app.MapChores();
app.MapLists();
app.MapMeals();
app.MapRecipes();
app.MapCalendarEvents();
app.MapGoogleConnection();
app.MapWeather();

app.Run();

// Lets the integration tests host the API with WebApplicationFactory<Program>.
public partial class Program;

