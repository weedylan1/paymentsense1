FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY apps/worker/PaymentSense.MatchLab.Worker.csproj apps/worker/
RUN dotnet restore apps/worker/PaymentSense.MatchLab.Worker.csproj

COPY apps/worker/ apps/worker/
RUN dotnet publish apps/worker/PaymentSense.MatchLab.Worker.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/runtime:10.0
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "PaymentSense.MatchLab.Worker.dll"]
