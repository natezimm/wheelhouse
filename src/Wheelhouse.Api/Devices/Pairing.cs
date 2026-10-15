using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Devices;

/// <summary>Where a display's pairing stands when it asks.</summary>
public abstract record PairingOutcome
{
    /// <summary>No parent has entered the code yet.</summary>
    public sealed record Waiting : PairingOutcome;

    /// <summary>A parent entered the code: the display can sign in as this device.</summary>
    public sealed record Paired(Device Device) : PairingOutcome;

    /// <summary>The code expired or never existed; the display should ask for a new one.</summary>
    public sealed record Gone : PairingOutcome;
}

/// <summary>
/// Pairs a wall display with a family: the display asks for a code and shows it, a parent
/// types the code on their phone, and the display then collects a sign-in for the device that
/// created. No password is ever typed on the wall.
/// </summary>
public sealed class Pairing(WheelhouseDbContext db, TimeProvider time)
{
    /// <summary>The most codes that may be waiting at once, which bounds what strangers can store.</summary>
    public const int MaxWaiting = 1000;

    /// <summary>A new code for a display, or null when too many are already waiting.</summary>
    public async Task<PairingCode?> StartAsync(CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        await db.PairingCodes.Where(p => p.ExpiresAt < now).ExecuteDeleteAsync(cancellationToken);

        if (await db.PairingCodes.CountAsync(cancellationToken) >= MaxWaiting)
        {
            return null;
        }

        // Expired codes are gone, so a code only has to differ from the ones still working.
        string code;
        do
        {
            code = RandomNumberGenerator.GetInt32(1_000_000).ToString("D6");
        }
        while (await db.PairingCodes.AnyAsync(p => p.Code == code, cancellationToken));

        var pairing = new PairingCode { Id = Guid.NewGuid(), Code = code, ExpiresAt = now + PairingCode.Lifetime };
        db.PairingCodes.Add(pairing);
        await db.SaveChangesAsync(cancellationToken);

        return pairing;
    }

    /// <summary>
    /// A parent of <paramref name="familyId"/> entered <paramref name="code"/>: the display
    /// showing it becomes one of the family's devices. Null when no display is waiting with it.
    /// </summary>
    public async Task<Device?> ClaimAsync(Guid familyId, string code, string name, CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var pairing = await db.PairingCodes.SingleOrDefaultAsync(
            p => p.Code == code && p.DeviceId == null && p.ExpiresAt >= now, cancellationToken);
        if (pairing is null)
        {
            return null;
        }

        var device = new Device { Id = Guid.CreateVersion7(), FamilyId = familyId, Name = name, PairedAt = now };
        db.Devices.Add(device);
        pairing.DeviceId = device.Id;
        // Give the display a full window to collect its sign-in, however late the code was entered.
        pairing.ExpiresAt = now + PairingCode.Lifetime;
        await db.SaveChangesAsync(cancellationToken);

        return device;
    }

    /// <summary>
    /// The display's question, asked every few seconds while it shows its code. Once paired,
    /// the code is used up: the display gets its sign-in exactly once.
    /// </summary>
    public async Task<PairingOutcome> FinishAsync(Guid pairingId, CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var pairing = await db.PairingCodes.SingleOrDefaultAsync(p => p.Id == pairingId && p.ExpiresAt >= now, cancellationToken);
        if (pairing is null)
        {
            return new PairingOutcome.Gone();
        }

        if (pairing.DeviceId is not { } deviceId)
        {
            return new PairingOutcome.Waiting();
        }

        // The display is not signed in yet, so there is no current family: opt out of the filter.
        var device = await db.Devices.IgnoreQueryFilters().SingleOrDefaultAsync(d => d.Id == deviceId, cancellationToken);
        db.PairingCodes.Remove(pairing);
        if (device is not null)
        {
            device.LastSeenAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);

        // A parent may have removed the display before it collected its sign-in.
        return device is null ? new PairingOutcome.Gone() : new PairingOutcome.Paired(device);
    }
}
