using System.Security.Claims;

namespace Wheelhouse.Api.Auth;

/// <summary>The family the current request acts for, taken from who is signed in.</summary>
public interface ICurrentFamily
{
    /// <summary>Null when there is no request or nobody is signed in.</summary>
    Guid? Id { get; }
}

internal sealed class HttpCurrentFamily(IHttpContextAccessor accessor) : ICurrentFamily
{
    public Guid? Id =>
        Guid.TryParse(accessor.HttpContext?.User.FindFirstValue(WheelhouseClaims.Family), out var id) ? id : null;
}
