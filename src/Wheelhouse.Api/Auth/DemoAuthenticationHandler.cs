using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Demo;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Auth;

/// <summary>
/// Signs every visitor in as a parent of the demo family, so the public demo needs no account.
/// It refuses to authenticate anyone unless the instance is in demo mode.
/// </summary>
internal sealed class DemoAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IOptions<InstanceOptions> instance)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Demo";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (instance.Value.Mode != InstanceMode.Demo)
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var identity = new ClaimsIdentity(
            [
                new Claim(WheelhouseClaims.Family, DemoFamily.Id.ToString()),
                new Claim(WheelhouseClaims.Role, Roles.Parent),
            ],
            SchemeName);

        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName)));
    }
}
