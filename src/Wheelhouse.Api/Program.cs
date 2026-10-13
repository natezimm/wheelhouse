using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Demo;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Health;
using Wheelhouse.Api.Instance;
using Wheelhouse.Api.Sessions;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOptions<InstanceOptions>().BindConfiguration(InstanceOptions.Section);

// Read the connection string when the context is first built, not here, so configuration
// added after this line (the integration tests' database) is the one that gets used.
builder.Services.AddDbContext<WheelhouseDbContext>((services, options) =>
    options.UseNpgsql(services.GetRequiredService<IConfiguration>().GetConnectionString("Wheelhouse")));

builder.Services.AddHealthChecks()
    .AddDbContextCheck<WheelhouseDbContext>("database");

builder.Services.AddWheelhouseAuth();

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<DemoSeeder>();
builder.Services.AddHostedService<DemoResetService>();

// Enums travel as their names ("Parent", "Demo"), which the web app's types mirror.
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

var app = builder.Build();

await app.PrepareDatabaseAsync();

app.UseAuthentication();
app.UseAuthorization();

app.MapHealth();
app.MapSession();
app.MapFamily();

app.Run();

// Lets the integration tests host the API with WebApplicationFactory<Program>.
public partial class Program;
