using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wheelhouse.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEventWrites : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ETag",
                table: "EventInstances",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            // Calendars chosen before this was recorded count as writable; Google refusing a change marks one read-only.
            migrationBuilder.AddColumn<bool>(
                name: "CanWrite",
                table: "CalendarSources",
                type: "boolean",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ETag",
                table: "EventInstances");

            migrationBuilder.DropColumn(
                name: "CanWrite",
                table: "CalendarSources");
        }
    }
}
