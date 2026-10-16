using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wheelhouse.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCalendar : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CalendarSources",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FamilyId = table.Column<Guid>(type: "uuid", nullable: false),
                    GoogleCalendarId = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    MemberId = table.Column<Guid>(type: "uuid", nullable: true),
                    LastSyncedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CalendarSources", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CalendarSources_Families_FamilyId",
                        column: x => x.FamilyId,
                        principalTable: "Families",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CalendarSources_Members_MemberId",
                        column: x => x.MemberId,
                        principalTable: "Members",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "EventInstances",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FamilyId = table.Column<Guid>(type: "uuid", nullable: false),
                    CalendarSourceId = table.Column<Guid>(type: "uuid", nullable: false),
                    GoogleEventId = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    RecurringEventId = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: true),
                    Title = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    Location = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: true),
                    StartsAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    EndsAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: true),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventInstances", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EventInstances_CalendarSources_CalendarSourceId",
                        column: x => x.CalendarSourceId,
                        principalTable: "CalendarSources",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CalendarSources_FamilyId_GoogleCalendarId",
                table: "CalendarSources",
                columns: new[] { "FamilyId", "GoogleCalendarId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CalendarSources_MemberId",
                table: "CalendarSources",
                column: "MemberId");

            migrationBuilder.CreateIndex(
                name: "IX_EventInstances_CalendarSourceId_GoogleEventId",
                table: "EventInstances",
                columns: new[] { "CalendarSourceId", "GoogleEventId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EventInstances_FamilyId_StartDate",
                table: "EventInstances",
                columns: new[] { "FamilyId", "StartDate" });

            migrationBuilder.CreateIndex(
                name: "IX_EventInstances_FamilyId_StartsAt",
                table: "EventInstances",
                columns: new[] { "FamilyId", "StartsAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EventInstances");

            migrationBuilder.DropTable(
                name: "CalendarSources");
        }
    }
}
