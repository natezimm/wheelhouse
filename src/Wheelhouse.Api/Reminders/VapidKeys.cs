using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Reminders;

/// <summary>
/// The instance's own VAPID key pair, which tells push services that a reminder comes from this
/// server. It is made the first time it is needed and kept in the database, its private half
/// encrypted with Data Protection like the Google token, so there is nothing to set up and
/// browsers' subscriptions keep working across restarts and releases.
/// </summary>
public sealed class PushKey
{
    /// <summary>There is one row, for the whole instance.</summary>
    public int Id { get; set; }

    /// <summary>The public key, an uncompressed P-256 point in base64url, as browsers take it.</summary>
    public required string PublicKey { get; set; }

    /// <summary>The private key's scalar, encrypted with Data Protection.</summary>
    public required string EncryptedPrivateKey { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class VapidKeys(IServiceScopeFactory scopes, IDataProtectionProvider dataProtection, TimeProvider time)
{
    public sealed record Pair(string PublicKey, byte[] PrivateKey)
    {
        public ECDsa Key()
        {
            var point = WebPush.Decode(PublicKey);
            return ECDsa.Create(new ECParameters
            {
                Curve = ECCurve.NamedCurves.nistP256,
                D = PrivateKey,
                Q = new ECPoint { X = point[1..33], Y = point[33..65] },
            });
        }
    }

    private readonly IDataProtector _protector = dataProtection.CreateProtector("Wheelhouse.Reminders.VapidPrivateKey");
    private readonly SemaphoreSlim _gate = new(1, 1);
    private Pair? _pair;

    public async Task<Pair> GetAsync(CancellationToken cancellationToken)
    {
        if (_pair is { } known)
        {
            return known;
        }

        await _gate.WaitAsync(cancellationToken);
        try
        {
            return _pair ??= await LoadOrCreateAsync(cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<Pair> LoadOrCreateAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WheelhouseDbContext>();
        if (await db.PushKeys.AsNoTracking().SingleOrDefaultAsync(k => k.Id == 1, cancellationToken) is not { } row)
        {
            using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
            var parameters = key.ExportParameters(includePrivateParameters: true);
            var made = new PushKey
            {
                Id = 1,
                PublicKey = WebPush.Encode([4, .. parameters.Q.X!, .. parameters.Q.Y!]),
                EncryptedPrivateKey = _protector.Protect(WebPush.Encode(parameters.D)),
                CreatedAt = time.GetUtcNow(),
            };
            // Another process may make one at the same moment; whichever is stored first is the key.
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"""INSERT INTO "PushKeys" ("Id", "PublicKey", "EncryptedPrivateKey", "CreatedAt") VALUES (1, {made.PublicKey}, {made.EncryptedPrivateKey}, {made.CreatedAt}) ON CONFLICT ("Id") DO NOTHING""",
                cancellationToken);
            row = await db.PushKeys.AsNoTracking().SingleAsync(k => k.Id == 1, cancellationToken);
        }

        return new Pair(row.PublicKey, WebPush.Decode(_protector.Unprotect(row.EncryptedPrivateKey)));
    }
}
