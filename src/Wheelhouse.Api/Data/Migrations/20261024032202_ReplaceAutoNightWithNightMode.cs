using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wheelhouse.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ReplaceAutoNightWithNightMode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "NightMode",
                table: "Families",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "AtNight");

            // A family that had automatic Night off keeps its screens light.
            migrationBuilder.Sql("""UPDATE "Families" SET "NightMode" = 'Off' WHERE NOT "AutoNight";""");

            migrationBuilder.DropColumn(
                name: "AutoNight",
                table: "Families");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AutoNight",
                table: "Families",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            // Always had no equivalent before; the nearest is dark at night.
            migrationBuilder.Sql("""UPDATE "Families" SET "AutoNight" = FALSE WHERE "NightMode" = 'Off';""");

            migrationBuilder.DropColumn(
                name: "NightMode",
                table: "Families");
        }
    }
}
