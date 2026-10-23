using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wheelhouse.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFamilyTheme : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AutoNight",
                table: "Families",
                type: "boolean",
                nullable: false,
                // Existing families keep turning dark at night, as new ones do.
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "Theme",
                table: "Families",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Daylight");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AutoNight",
                table: "Families");

            migrationBuilder.DropColumn(
                name: "Theme",
                table: "Families");
        }
    }
}
