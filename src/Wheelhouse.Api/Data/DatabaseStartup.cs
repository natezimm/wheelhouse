using Microsoft.EntityFrameworkCore;

namespace Wheelhouse.Api.Data;

public static class DatabaseStartup
{
    /// <summary>
    /// Brings the schema up to date before the API takes its first request. If the database
    /// cannot be reached this throws and the process exits; the container's restart policy
    /// tries again.
    /// </summary>
    public static async Task PrepareDatabaseAsync(this WebApplication app)
    {
        await using var scope = app.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<WheelhouseDbContext>().Database.MigrateAsync();
    }
}
