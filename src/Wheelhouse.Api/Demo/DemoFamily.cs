using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Demo;

/// <summary>The fictional family every new demo visitor starts from.</summary>
public static class DemoFamily
{
    public static Family Create(Guid familyId, DateTimeOffset expiresAt) => DemoSeedAdapter.Create(familyId, expiresAt);
}

