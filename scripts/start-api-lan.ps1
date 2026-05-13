$env:DATABASE_URL = "Host=localhost;Port=5432;Database=myapp;Username=postgres;Password=SuperSecret123!"
$env:ASPNETCORE_URLS = "http://0.0.0.0:5157"

dotnet "C:\Users\Dan Campbell\Documents\New project\apps\api\bin\Debug\net10.0\PaymentSense.MatchLab.Api.dll"
