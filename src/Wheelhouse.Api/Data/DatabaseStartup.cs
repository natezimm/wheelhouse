using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Demo;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Data;

public static class DatabaseStartup
{
    /// <summary>
    /// Brings the schema up to date before the API takes its first request, and on a demo
    /// instance starts from a freshly seeded family. If the database cannot be reached this
    /// throws and the process exits; the container's restart policy tries again.
    /// </summary>
    public static async Task PrepareDatabaseAsync(this WebApplication app)
    {
        await using var scope = app.Services.CreateAsyncScope();

        await scope.ServiceProvider.GetRequiredService<WheelhouseDbContext>().Database.MigrateAsync();

        if (scope.ServiceProvider.GetRequiredService<IOptions<InstanceOptions>>().Value.Mode == InstanceMode.Demo)
        {
            await scope.ServiceProvider.GetRequiredService<DemoSeeder>().ResetAsync();
        }
    }
}
