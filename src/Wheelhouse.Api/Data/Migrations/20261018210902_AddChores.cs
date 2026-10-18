using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wheelhouse.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddChores : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "ChoresChangeNumber",
                table: "Families",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.CreateTable(
                name: "Chores",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FamilyId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreationId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreationRequest = table.Column<string>(type: "text", nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    MemberId = table.Column<Guid>(type: "uuid", nullable: true),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    CompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Archived = table.Column<bool>(type: "boolean", nullable: false),
                    Version = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Chores", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Chores_Families_FamilyId",
                        column: x => x.FamilyId,
                        principalTable: "Families",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Chores_Members_MemberId",
                        column: x => x.MemberId,
                        principalTable: "Members",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Chores_FamilyId_CreationId",
                table: "Chores",
                columns: new[] { "FamilyId", "CreationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Chores_FamilyId_DueDate",
                table: "Chores",
                columns: new[] { "FamilyId", "DueDate" });

            migrationBuilder.CreateIndex(
                name: "IX_Chores_MemberId",
                table: "Chores",
                column: "MemberId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Chores");

            migrationBuilder.DropColumn(
                name: "ChoresChangeNumber",
                table: "Families");
        }
    }
}
