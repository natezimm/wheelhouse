using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;

namespace Wheelhouse.Api.Calendar;

/// <summary>
/// Encrypts the shared account's refresh token at rest, and signs the state that carries a
/// parent through Google's consent screen. Both use ASP.NET Core Data Protection, whose keys
/// live on their own volume, so a copy of the database alone does not reveal the token.
/// </summary>
public sealed class GoogleTokens(IDataProtectionProvider dataProtection, TimeProvider time)
{
    /// <summary>How long a parent has to finish Google's consent screen.</summary>
    public static readonly TimeSpan ConsentTimeout = TimeSpan.FromMinutes(15);

    private readonly IDataProtector _refreshTokens = dataProtection.CreateProtector("Wheelhouse.Calendar.GoogleRefreshToken");

    private readonly ITimeLimitedDataProtector _consentState = dataProtection
        .CreateProtector("Wheelhouse.Calendar.GoogleConsentState")
        .ToTimeLimitedDataProtector();

    public string Protect(string refreshToken) => _refreshTokens.Protect(refreshToken);

    public string Unprotect(string encryptedRefreshToken) => _refreshTokens.Unprotect(encryptedRefreshToken);

    /// <summary>
    /// The <c>state</c> sent to Google. It names the family the consent is for, so a code
    /// obtained by someone else cannot be attached to this family.
    /// </summary>
    public string ConsentState(Guid familyId) => _consentState.Protect(
        $"{familyId:N}.{Convert.ToHexString(RandomNumberGenerator.GetBytes(8))}",
        time.GetUtcNow().Add(ConsentTimeout));

    /// <summary>Whether <paramref name="state"/> came from <see cref="ConsentState"/> for this family and is still fresh.</summary>
    public bool IsConsentStateFor(string state, Guid familyId)
    {
        try
        {
            var payload = _consentState.Unprotect(state, out var expiration);
            return expiration > time.GetUtcNow() && payload.StartsWith($"{familyId:N}.", StringComparison.Ordinal);
        }
        catch (CryptographicException)
        {
            return false;
        }
    }
}
