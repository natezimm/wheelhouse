using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wheelhouse.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEventNotesAndRule : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Description",
                table: "EventInstances",
                type: "character varying(8192)",
                maxLength: 8192,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Recurrence",
                table: "EventInstances",
                type: "character varying(1024)",
                maxLength: 1024,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Description",
                table: "EventInstances");

            migrationBuilder.DropColumn(
                name: "Recurrence",
                table: "EventInstances");
        }
    }
}
