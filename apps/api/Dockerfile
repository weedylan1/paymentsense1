FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY apps/api/PaymentSense.MatchLab.Api.csproj apps/api/
RUN dotnet restore apps/api/PaymentSense.MatchLab.Api.csproj

COPY apps/api/ apps/api/
RUN dotnet publish apps/api/PaymentSense.MatchLab.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
ENV ASPNETCORE_URLS=http://0.0.0.0:8080
ENV NODE_PATH=/automation/node_modules
EXPOSE 8080

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json /automation/
WORKDIR /automation
RUN npm ci

COPY scripts /scripts
COPY playwright/.auth /playwright/.auth
RUN npx playwright install --with-deps chromium

WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "PaymentSense.MatchLab.Api.dll"]
