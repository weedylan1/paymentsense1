using System.Security.Cryptography;
using Npgsql;

var options = MigrationOptions.Parse(args);
if (options.ShowHelp)
{
    MigrationOptions.PrintHelp();
    return 0;
}

var connectionString = Environment.GetEnvironmentVariable("DATABASE_URL");
if (string.IsNullOrWhiteSpace(connectionString))
{
    Console.Error.WriteLine("Set DATABASE_URL before running the migrator.");
    return 2;
}

var migrationsPath = options.MigrationsPath ?? FindMigrationsPath();
if (!Directory.Exists(migrationsPath))
{
    Console.Error.WriteLine($"Migrations directory was not found: {migrationsPath}");
    return 2;
}

var migrations = Directory
    .GetFiles(migrationsPath, "*.sql")
    .Select(MigrationFile.Load)
    .OrderBy(migration => migration.Version, StringComparer.Ordinal)
    .ToArray();

if (migrations.Length == 0)
{
    Console.WriteLine($"No migration files found in {migrationsPath}.");
    return 0;
}

await using var dataSource = NpgsqlDataSource.Create(connectionString);
await using var connection = await dataSource.OpenConnectionAsync();

var historyExists = await HistoryTableExistsAsync(connection);
var applied = historyExists
    ? await LoadAppliedMigrationsAsync(connection)
    : new Dictionary<string, AppliedMigration>(StringComparer.Ordinal);

var mismatches = migrations
    .Where(migration =>
        applied.TryGetValue(migration.Version, out var existing) &&
        !string.Equals(existing.ChecksumSha256, migration.ChecksumSha256, StringComparison.OrdinalIgnoreCase))
    .ToArray();

if (mismatches.Length > 0)
{
    Console.Error.WriteLine("Applied migration checksum mismatch detected. Do not continue until this is understood:");
    foreach (var mismatch in mismatches)
    {
        Console.Error.WriteLine($"  {mismatch.Version} {mismatch.FileName}");
    }

    return 3;
}

var pending = migrations
    .Where(migration => !applied.ContainsKey(migration.Version))
    .ToArray();

if (options.Plan)
{
    Console.WriteLine(historyExists
        ? "Migration history table exists."
        : "Migration history table does not exist yet.");
    Console.WriteLine($"Applied migrations: {applied.Count}");
    Console.WriteLine($"Pending migrations: {pending.Length}");

    foreach (var migration in pending)
    {
        Console.WriteLine($"  pending {migration.FileName}");
    }

    if (!historyExists)
    {
        Console.WriteLine();
        Console.WriteLine("For an existing database, run --baseline-current once before using --apply.");
    }

    return 0;
}

if (options.BaselineCurrent)
{
    await EnsureHistoryTableAsync(connection);
    await using var transaction = await connection.BeginTransactionAsync();

    foreach (var migration in migrations)
    {
        await RecordMigrationAsync(connection, transaction, migration, appliedBy: "baseline");
    }

    await transaction.CommitAsync();
    Console.WriteLine($"Baselined {migrations.Length} migration(s). No migration SQL was executed.");
    return 0;
}

if (!options.Apply)
{
    Console.WriteLine("No database changes made. Use --plan, --baseline-current, or --apply.");
    return 0;
}

await EnsureHistoryTableAsync(connection);
if (pending.Length == 0)
{
    Console.WriteLine("Database is already up to date.");
    return 0;
}

foreach (var migration in pending)
{
    Console.WriteLine($"Applying {migration.FileName}...");
    await using var transaction = await connection.BeginTransactionAsync();
    await using (var command = new NpgsqlCommand(migration.Sql, connection, transaction))
    {
        command.CommandTimeout = options.CommandTimeoutSeconds;
        await command.ExecuteNonQueryAsync();
    }

    await RecordMigrationAsync(connection, transaction, migration, appliedBy: "migrator");
    await transaction.CommitAsync();
}

Console.WriteLine($"Applied {pending.Length} migration(s).");
return 0;

static string FindMigrationsPath()
{
    var current = new DirectoryInfo(AppContext.BaseDirectory);
    while (current is not null)
    {
        var candidate = Path.Combine(current.FullName, "db", "migrations");
        if (Directory.Exists(candidate))
        {
            return candidate;
        }

        current = current.Parent;
    }

    return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "db", "migrations"));
}

static async Task<bool> HistoryTableExistsAsync(NpgsqlConnection connection)
{
    await using var command = new NpgsqlCommand("""
        select exists (
          select 1
          from information_schema.tables
          where table_schema = 'paymentsense_core'
            and table_name = 'schema_migrations'
        )
        """, connection);
    return (bool)(await command.ExecuteScalarAsync() ?? false);
}

static async Task<Dictionary<string, AppliedMigration>> LoadAppliedMigrationsAsync(NpgsqlConnection connection)
{
    var result = new Dictionary<string, AppliedMigration>(StringComparer.Ordinal);
    await using var command = new NpgsqlCommand("""
        select version, file_name, checksum_sha256
        from paymentsense_core.schema_migrations
        """, connection);

    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        var migration = new AppliedMigration(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetString(2));
        result[migration.Version] = migration;
    }

    return result;
}

static async Task EnsureHistoryTableAsync(NpgsqlConnection connection)
{
    await using var command = new NpgsqlCommand("""
        create schema if not exists paymentsense_core;

        create table if not exists paymentsense_core.schema_migrations (
          version text primary key,
          file_name text not null,
          checksum_sha256 text not null,
          applied_at timestamptz not null default now(),
          applied_by text not null
        );
        """, connection);
    await command.ExecuteNonQueryAsync();
}

static async Task RecordMigrationAsync(
    NpgsqlConnection connection,
    NpgsqlTransaction transaction,
    MigrationFile migration,
    string appliedBy)
{
    await using var command = new NpgsqlCommand("""
        insert into paymentsense_core.schema_migrations (
          version,
          file_name,
          checksum_sha256,
          applied_by
        )
        values (
          @version,
          @file_name,
          @checksum_sha256,
          @applied_by
        )
        on conflict (version) do update
        set file_name = excluded.file_name,
            checksum_sha256 = excluded.checksum_sha256,
            applied_by = excluded.applied_by
        """, connection, transaction);
    command.Parameters.AddWithValue("version", migration.Version);
    command.Parameters.AddWithValue("file_name", migration.FileName);
    command.Parameters.AddWithValue("checksum_sha256", migration.ChecksumSha256);
    command.Parameters.AddWithValue("applied_by", appliedBy);
    await command.ExecuteNonQueryAsync();
}

internal sealed record MigrationFile(
    string Version,
    string FileName,
    string Path,
    string Sql,
    string ChecksumSha256)
{
    public static MigrationFile Load(string path)
    {
        var fileName = System.IO.Path.GetFileName(path);
        var version = fileName.Split('_', 2)[0];
        var sql = File.ReadAllText(path);
        var checksum = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
        return new MigrationFile(version, fileName, path, sql, checksum);
    }
}

internal sealed record AppliedMigration(string Version, string FileName, string ChecksumSha256);

internal sealed record MigrationOptions(
    bool Plan,
    bool Apply,
    bool BaselineCurrent,
    bool ShowHelp,
    string? MigrationsPath,
    int CommandTimeoutSeconds)
{
    public static MigrationOptions Parse(string[] args)
    {
        var plan = false;
        var apply = false;
        var baseline = false;
        var showHelp = false;
        string? migrationsPath = null;
        var timeout = 300;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--plan":
                    plan = true;
                    break;
                case "--apply":
                    apply = true;
                    break;
                case "--baseline-current":
                    baseline = true;
                    break;
                case "--help":
                case "-h":
                    showHelp = true;
                    break;
                case "--migrations-path":
                    migrationsPath = args[++i];
                    break;
                case "--timeout-seconds":
                    timeout = int.Parse(args[++i]);
                    break;
                default:
                    throw new ArgumentException($"Unknown argument: {args[i]}");
            }
        }

        var selectedModes = new[] { plan, apply, baseline }.Count(value => value);
        if (selectedModes > 1)
        {
            throw new ArgumentException("Choose only one mode: --plan, --apply, or --baseline-current.");
        }

        return new MigrationOptions(plan, apply, baseline, showHelp, migrationsPath, timeout);
    }

    public static void PrintHelp()
    {
        Console.WriteLine("""
            PaymentSense MatchLab database migrator

            Modes:
              --plan              Show migration history and pending files. Makes no database changes.
              --baseline-current  Mark all current migration files as applied. Does not execute migration SQL.
              --apply             Execute pending migration SQL and record successful versions.

            Options:
              --migrations-path <path>   Override db/migrations path.
              --timeout-seconds <value>  SQL command timeout, default 300.
            """);
    }
}
