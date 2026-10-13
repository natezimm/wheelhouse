using Microsoft.EntityFrameworkCore;

namespace Wheelhouse.Api.Data;

public sealed class WheelhouseDbContext(DbContextOptions<WheelhouseDbContext> options) : DbContext(options);
