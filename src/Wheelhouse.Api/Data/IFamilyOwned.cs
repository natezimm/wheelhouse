namespace Wheelhouse.Api.Data;

/// <summary>
/// A row that belongs to one family. <see cref="WheelhouseDbContext"/> filters every query on
/// these to the current family, so one family can never read another's rows by accident.
/// </summary>
public interface IFamilyOwned
{
    Guid FamilyId { get; }
}
