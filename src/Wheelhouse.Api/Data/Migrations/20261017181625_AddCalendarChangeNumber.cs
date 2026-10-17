using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wheelhouse.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCalendarChangeNumber : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "CalendarChangeNumber",
                table: "Families",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CalendarChangeNumber",
                table: "Families");
        }
    }
}
