FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY ["Telesale Services/Telesale Services.csproj", "Telesale Services/"]
RUN dotnet restore "Telesale Services/Telesale Services.csproj"

COPY ["Telesale Services/", "Telesale Services/"]
RUN dotnet publish "Telesale Services/Telesale Services.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "Telesale Services.dll"]
