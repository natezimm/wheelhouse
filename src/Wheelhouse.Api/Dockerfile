# Build from the repository root: docker build -f src/Wheelhouse.Api/Dockerfile .
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/Wheelhouse.Api/Wheelhouse.Api.csproj src/Wheelhouse.Api/
RUN dotnet restore src/Wheelhouse.Api/Wheelhouse.Api.csproj
COPY src/Wheelhouse.Api/ src/Wheelhouse.Api/
RUN dotnet publish src/Wheelhouse.Api/Wheelhouse.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app ./
# Sign-in cookies are protected with keys kept here. Compose mounts a volume on it so the keys
# outlive the container; creating it now, owned by the app user, makes that volume writable.
RUN install --directory --owner=$APP_UID --group=$APP_UID /home/app/.aspnet/DataProtection-Keys
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "Wheelhouse.Api.dll"]
