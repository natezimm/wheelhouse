using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Health;

var builder = WebApplication.CreateBuilder(args);

// Read the connection string when the context is first built, not here, so configuration
// added after this line (the integration tests' database) is the one that gets used.
builder.Services.AddDbContext<WheelhouseDbContext>((services, options) =>
    options.UseNpgsql(services.GetRequiredService<IConfiguration>().GetConnectionString("Wheelhouse")));

builder.Services.AddHealthChecks()
    .AddDbContextCheck<WheelhouseDbContext>("database");

var app = builder.Build();

app.MapHealth();

app.Run();

// Lets the integration tests host the API with WebApplicationFactory<Program>.
public partial class Program;
