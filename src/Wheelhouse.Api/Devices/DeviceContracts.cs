namespace Wheelhouse.Api.Devices;

/// <summary>What a display needs to show its code and ask whether it has been paired.</summary>
public sealed record PairingResponse(Guid Id, string Code, DateTimeOffset ExpiresAt);

public sealed record DeviceResponse(Guid Id, string Name, DateTimeOffset PairedAt, DateTimeOffset? LastSeenAt)
{
    public static DeviceResponse From(Device device) => new(device.Id, device.Name, device.PairedAt, device.LastSeenAt);
}

/// <summary>What a parent types on their phone: the code on the display, and a name for it.</summary>
public sealed record PairDisplayRequest(string Code, string Name)
{
    /// <summary>The code's six digits, allowing for the space or dash a person might type between them.</summary>
    public string Digits => new((Code ?? "").Where(c => !char.IsWhiteSpace(c) && c != '-').ToArray());

    public Dictionary<string, string[]> Validate()
    {
        var errors = new Dictionary<string, string[]>();

        if (Digits is not { Length: 6 } digits || !digits.All(char.IsAsciiDigit))
        {
            errors["code"] = ["Enter the 6-digit code from the display."];
        }

        if (string.IsNullOrWhiteSpace(Name) || Name.Trim().Length > 50)
        {
            errors["name"] = ["Enter a name of up to 50 characters."];
        }

        return errors;
    }
}
