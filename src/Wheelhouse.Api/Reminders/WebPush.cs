using System.Buffers.Binary;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Wheelhouse.Api.Reminders;

/// <summary>Where a browser asked its push service to deliver, and the keys it gave for encrypting to it.</summary>
public sealed record PushTarget(string Endpoint, string P256dh, string Auth);

/// <summary>What became of one push: delivered, gone for good (the browser unsubscribed), or failed for now.</summary>
public enum PushOutcome
{
    Sent,
    Gone,
    Failed,
}

/// <summary>
/// Sends Web Push messages (RFC 8030) encrypted for the browser (RFC 8291, aes128gcm) and signed
/// with the server's VAPID key (RFC 8292), using only .NET's own cryptography. The push service is
/// the browser maker's (Google, Mozilla, Apple, Microsoft): it never sees the message itself.
/// </summary>
public sealed class WebPush(HttpClient http, VapidKeys keys, TimeProvider time, ILogger<WebPush> logger)
{
    /// <summary>How long a push service may hold a message for a phone that is off: a reminder is no use later.</summary>
    public static readonly TimeSpan TimeToLive = TimeSpan.FromMinutes(30);

    /// <summary>
    /// The push services the browsers use. A subscription's endpoint must be on one of them, so a
    /// signed-in visitor cannot make the server send requests anywhere else.
    /// </summary>
    private static readonly string[] PushHosts =
    [
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        ".push.services.mozilla.com",
        ".push.apple.com",
        ".notify.windows.com",
    ];

    public static bool IsPushEndpoint(string endpoint) =>
        Uri.TryCreate(endpoint, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps
        && uri.IsDefaultPort
        && string.IsNullOrEmpty(uri.UserInfo)
        && PushHosts.Any(host => host.StartsWith('.')
            ? uri.Host.EndsWith(host, StringComparison.OrdinalIgnoreCase)
            : uri.Host.Equals(host, StringComparison.OrdinalIgnoreCase));

    /// <summary>Whether the browser's keys have the right shape: a P-256 point and a 16-byte secret.</summary>
    public static bool AreKeys(string p256dh, string auth)
    {
        if (TryDecode(p256dh) is not { Length: 65 } point || point[0] != 4 || TryDecode(auth) is not { Length: 16 })
        {
            return false;
        }

        try
        {
            // A point off the curve is refused here rather than at every reminder.
            Encrypt([], new PushTarget("", p256dh, auth));
            return true;
        }
        catch (CryptographicException)
        {
            return false;
        }
    }

    public async Task<PushOutcome> SendAsync(PushTarget target, object message, string subject, CancellationToken cancellationToken)
    {
        var vapid = await keys.GetAsync(cancellationToken);
        var endpoint = new Uri(target.Endpoint);
        byte[] body;
        try
        {
            body = Encrypt(JsonSerializer.SerializeToUtf8Bytes(message, JsonSerializerOptions.Web), target);
        }
        catch (CryptographicException)
        {
            // Not a key anything can encrypt to, so no push can ever reach it.
            return PushOutcome.Gone;
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint) { Content = new ByteArrayContent(body) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        request.Content.Headers.ContentEncoding.Add("aes128gcm");
        request.Headers.Add("TTL", ((int)TimeToLive.TotalSeconds).ToString());
        request.Headers.Add("Urgency", "high");
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "vapid", $"t={Token(vapid, endpoint, subject)}, k={vapid.PublicKey}");

        try
        {
            using var response = await http.SendAsync(request, cancellationToken);
            if (response.IsSuccessStatusCode)
            {
                return PushOutcome.Sent;
            }

            if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
            {
                return PushOutcome.Gone;
            }

            logger.LogWarning("The push service at {Host} answered {Status}", endpoint.Host, (int)response.StatusCode);
            return PushOutcome.Failed;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(exception, "Could not reach the push service at {Host}", endpoint.Host);
            return PushOutcome.Failed;
        }
    }

    /// <summary>The VAPID token: a JWT signed with ES256, for this push service's origin, good for twelve hours.</summary>
    private string Token(VapidKeys.Pair vapid, Uri endpoint, string subject)
    {
        var header = Encode("""{"typ":"JWT","alg":"ES256"}"""u8);
        var claims = Encode(JsonSerializer.SerializeToUtf8Bytes(new
        {
            aud = endpoint.GetLeftPart(UriPartial.Authority),
            exp = (time.GetUtcNow() + TimeSpan.FromHours(12)).ToUnixTimeSeconds(),
            sub = subject,
        }));
        var signed = $"{header}.{claims}";
        using var key = vapid.Key();
        // .NET signs ECDSA in IEEE P1363 form, the 64 bytes of r and s that JWT wants.
        return $"{signed}.{Encode(key.SignData(Encoding.ASCII.GetBytes(signed), HashAlgorithmName.SHA256))}";
    }

    /// <summary>Encrypts one record for the browser, as RFC 8291 says, with a new key and salt each time.</summary>
    public static byte[] Encrypt(byte[] plaintext, PushTarget target)
    {
        var browserKey = Decode(target.P256dh);
        var authSecret = Decode(target.Auth);

        using var browser = ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = browserKey[1..33], Y = browserKey[33..65] },
        });
        using var server = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var serverPoint = server.ExportParameters(false).Q;
        byte[] serverKey = [4, .. serverPoint.X!, .. serverPoint.Y!];
        var shared = server.DeriveRawSecretAgreement(browser.PublicKey);

        byte[] keyInfo = [.. "WebPush: info\0"u8, .. browserKey, .. serverKey];
        var ikm = HKDF.DeriveKey(HashAlgorithmName.SHA256, shared, 32, authSecret, keyInfo);
        var salt = RandomNumberGenerator.GetBytes(16);
        var prk = HKDF.Extract(HashAlgorithmName.SHA256, ikm, salt);
        var contentKey = HKDF.Expand(HashAlgorithmName.SHA256, prk, 16, "Content-Encoding: aes128gcm\0"u8.ToArray());
        var nonce = HKDF.Expand(HashAlgorithmName.SHA256, prk, 12, "Content-Encoding: nonce\0"u8.ToArray());

        // One record, so it is the last: its padding delimiter is 2.
        byte[] padded = [.. plaintext, 2];
        var ciphertext = new byte[padded.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(contentKey, tag.Length))
        {
            aes.Encrypt(nonce, padded, ciphertext, tag);
        }

        // The header: salt, record size, and the server's public key as the key id.
        var recordSize = new byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(recordSize, 4096);
        return [.. salt, .. recordSize, (byte)serverKey.Length, .. serverKey, .. ciphertext, .. tag];
    }

    public static string Encode(ReadOnlySpan<byte> bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static byte[] Decode(string text) => TryDecode(text) ?? throw new FormatException("Not base64url.");

    private static byte[]? TryDecode(string text)
    {
        if (text.Length > 256)
        {
            return null;
        }

        var base64 = text.Replace('-', '+').Replace('_', '/').TrimEnd('=');
        base64 = base64.PadRight(base64.Length + (4 - base64.Length % 4) % 4, '=');
        var bytes = new byte[base64.Length];
        return Convert.TryFromBase64String(base64, bytes, out var written) ? bytes[..written] : null;
    }
}
