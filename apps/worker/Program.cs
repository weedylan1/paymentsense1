using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Hosting;
using Npgsql;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

var builder = Host.CreateApplicationBuilder(args);

var connectionString =
    builder.Configuration.GetConnectionString("Postgres") ??
    Environment.GetEnvironmentVariable("DATABASE_URL");

if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException("Set ConnectionStrings:Postgres or DATABASE_URL before starting the worker.");
}

builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(connectionString));
builder.Services.AddHttpClient();
builder.Services.AddHostedService<JobWorkerService>();

await builder.Build().RunAsync();

internal sealed class JobWorkerService(
    IConfiguration configuration,
    NpgsqlDataSource db,
    IHttpClientFactory httpClientFactory,
    ILogger<JobWorkerService> logger) : BackgroundService
{
    private const string QueueName = "matchlab.jobs";
    private readonly string _rabbitHost = configuration["RabbitMq:Host"] ?? "localhost";
    private readonly string _rabbitUser = configuration["RabbitMq:Username"] ?? "admin";
    private readonly string _rabbitPassword = configuration["RabbitMq:Password"] ?? "SuperSecret123!";
    private readonly string _rabbitVHost = configuration["RabbitMq:VHost"] ?? "/";
    private readonly string _geminiModel = configuration["Gemini:Model"] ?? "gemini-3-flash-preview";
    private IConnection? _connection;
    private IModel? _channel;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        EnsureBroker();
        StartConsumer(stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RecoverStaleRunningJobsAsync(stoppingToken);
                await DispatchDueJobsAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Job worker maintenance loop failed.");
            }

            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }

    public override void Dispose()
    {
        _channel?.Dispose();
        _connection?.Dispose();
        base.Dispose();
    }

    private void EnsureBroker()
    {
        if (_connection is { IsOpen: true } && _channel is { IsOpen: true })
        {
            return;
        }

        _channel?.Dispose();
        _connection?.Dispose();

        var factory = new ConnectionFactory
        {
            HostName = _rabbitHost,
            UserName = _rabbitUser,
            Password = _rabbitPassword,
            VirtualHost = _rabbitVHost,
            DispatchConsumersAsync = true,
            AutomaticRecoveryEnabled = true,
            NetworkRecoveryInterval = TimeSpan.FromSeconds(10)
        };

        _connection = factory.CreateConnection("matchlab-worker");
        _channel = _connection.CreateModel();
        _channel.QueueDeclare(queue: QueueName, durable: true, exclusive: false, autoDelete: false, arguments: null);
        _channel.BasicQos(0, 1, false);
    }

    private void StartConsumer(CancellationToken stoppingToken)
    {
        EnsureBroker();
        var consumer = new AsyncEventingBasicConsumer(_channel!);
        consumer.Received += async (_, eventArgs) =>
        {
            var body = Encoding.UTF8.GetString(eventArgs.Body.ToArray());
            if (!long.TryParse(body, out var jobId))
            {
                _channel!.BasicAck(eventArgs.DeliveryTag, false);
                return;
            }

            try
            {
                await ProcessJobAsync(jobId, stoppingToken);
                _channel!.BasicAck(eventArgs.DeliveryTag, false);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Job {JobId} processing failed.", jobId);
                _channel!.BasicAck(eventArgs.DeliveryTag, false);
            }
        };

        _channel!.BasicConsume(queue: QueueName, autoAck: false, consumer: consumer);
    }

    private async Task DispatchDueJobsAsync(CancellationToken cancellationToken)
    {
        EnsureBroker();

        var pendingOutbox = new List<JobOutboxDispatchRow>();
        await using (var command = db.CreateCommand("""
            select o.id, o.job_id, j.status, j.cancel_requested, j.removed_at is not null
            from paymentsense_core.job_outbox o
            join paymentsense_core.queued_jobs j on j.id = o.job_id
            where o.published_at is null
              and o.event_type = 'enqueue'
              and j.scheduled_for <= now()
            order by o.id
            limit 100
            """))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                pendingOutbox.Add(new JobOutboxDispatchRow(
                    reader.GetInt64(0),
                    reader.GetInt64(1),
                    reader.GetString(2),
                    reader.GetBoolean(3),
                    reader.GetBoolean(4)));
            }
        }

        foreach (var row in pendingOutbox)
        {
            if (row.IsRemoved || row.Status is "completed" or "cancelled")
            {
                await MarkOutboxPublishedAsync(row.OutboxId, cancellationToken);
                continue;
            }

            if (row.CancelRequested || row.Status == "cancel_requested")
            {
                await CancelQueuedJobAsync(row.JobId, cancellationToken);
                await MarkOutboxPublishedAsync(row.OutboxId, cancellationToken);
                continue;
            }

            var properties = _channel!.CreateBasicProperties();
            properties.Persistent = true;
            var body = Encoding.UTF8.GetBytes(row.JobId.ToString(CultureInfo.InvariantCulture));
            _channel.BasicPublish("", QueueName, properties, body);

            await using var command = db.CreateCommand("""
                update paymentsense_core.job_outbox
                set published_at = now(),
                    updated_at = now()
                where id = @id;

                update paymentsense_core.queued_jobs
                set status = case when status = 'pending' then 'queued' else status end,
                    queued_at = coalesce(queued_at, now()),
                    updated_at = now()
                where id = @job_id
                  and removed_at is null
                """);
            command.Parameters.AddWithValue("id", row.OutboxId);
            command.Parameters.AddWithValue("job_id", row.JobId);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private async Task RecoverStaleRunningJobsAsync(CancellationToken cancellationToken)
    {
        var staleIds = new List<long>();
        await using (var command = db.CreateCommand("""
            update paymentsense_core.queued_jobs
            set status = 'pending',
                queued_at = null,
                started_at = null,
                last_heartbeat_at = null,
                current_step = 'Recovered after restart',
                error_text = 'Recovered after stale heartbeat.',
                updated_at = now()
            where removed_at is null
              and status in ('running', 'cancel_requested')
              and last_heartbeat_at < now() - interval '90 seconds'
            returning id
            """))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                staleIds.Add(reader.GetInt64(0));
            }
        }

        foreach (var jobId in staleIds)
        {
            await EnqueueJobOutboxAsync(jobId, cancellationToken);
        }
    }

    private async Task ProcessJobAsync(long jobId, CancellationToken stoppingToken)
    {
        var job = await TryAcquireJobAsync(jobId, stoppingToken);
        if (job is null)
        {
            return;
        }

        using var heartbeatCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        var heartbeatTask = RunHeartbeatAsync(jobId, heartbeatCts.Token);

        try
        {
            var resultJson = job.JobType switch
            {
                "ai_company_insight" => await ExecuteAiCompanyInsightJobAsync(job, stoppingToken),
                _ => throw new InvalidOperationException($"Unsupported job type '{job.JobType}'.")
            };

            heartbeatCts.Cancel();
            await SafeAwaitAsync(heartbeatTask);

            await using var command = db.CreateCommand("""
                update paymentsense_core.queued_jobs
                set status = 'completed',
                    result_json = @result_json::jsonb,
                    current_step = 'Completed',
                    completed_at = now(),
                    last_heartbeat_at = now(),
                    updated_at = now()
                where id = @id
                """);
            command.Parameters.AddWithValue("id", jobId);
            command.Parameters.AddWithValue("result_json", resultJson);
            await command.ExecuteNonQueryAsync(stoppingToken);
        }
        catch (Exception ex)
        {
            heartbeatCts.Cancel();
            await SafeAwaitAsync(heartbeatTask);

            await using var command = db.CreateCommand("""
                update paymentsense_core.queued_jobs
                set status = case when cancel_requested then 'cancelled' else 'failed' end,
                    current_step = case when cancel_requested then 'Cancelled' else 'Failed' end,
                    error_text = @error_text,
                    completed_at = now(),
                    updated_at = now()
                where id = @id
                """);
            command.Parameters.AddWithValue("id", jobId);
            command.Parameters.AddWithValue("error_text", ex.Message);
            await command.ExecuteNonQueryAsync(stoppingToken);
        }
    }

    private async Task<QueuedJobWorkerRow?> TryAcquireJobAsync(long jobId, CancellationToken cancellationToken)
    {
        await using var command = db.CreateCommand("""
            update paymentsense_core.queued_jobs
            set status = 'running',
                started_at = coalesce(started_at, now()),
                last_heartbeat_at = now(),
                current_step = 'Starting',
                attempt_count = attempt_count + 1,
                updated_at = now()
            where id = @id
              and removed_at is null
              and cancel_requested = false
              and status in ('pending', 'queued')
            returning id, job_type, payload_json::text, requested_by_user_id
            """);
        command.Parameters.AddWithValue("id", jobId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            var cancelled = await TryFinalizeCancelledJobAsync(jobId, cancellationToken);
            return cancelled ? null : null;
        }

        return new QueuedJobWorkerRow(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetInt64(3));
    }

    private async Task<bool> TryFinalizeCancelledJobAsync(long jobId, CancellationToken cancellationToken)
    {
        await using var command = db.CreateCommand("""
            update paymentsense_core.queued_jobs
            set status = 'cancelled',
                current_step = 'Cancelled',
                completed_at = now(),
                updated_at = now()
            where id = @id
              and removed_at is null
              and cancel_requested = true
              and status in ('pending', 'queued', 'cancel_requested')
            """);
        command.Parameters.AddWithValue("id", jobId);
        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    private async Task RunHeartbeatAsync(long jobId, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken);
                await using var command = db.CreateCommand("""
                    update paymentsense_core.queued_jobs
                    set last_heartbeat_at = now(),
                        updated_at = now()
                    where id = @id
                      and status in ('running', 'cancel_requested')
                    """);
                command.Parameters.AddWithValue("id", jobId);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task<string> ExecuteAiCompanyInsightJobAsync(QueuedJobWorkerRow job, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Deserialize<AiCompanyInsightJobPayload>(job.PayloadJson, JsonDefaults.Options)
            ?? throw new InvalidOperationException("Invalid AI Company Insight job payload.");

        await SetCurrentStepAsync(job.Id, "Loading Gemini key", cancellationToken);
        var geminiKey = await LoadAppSettingAsync("gemini_api_key", cancellationToken);
        if (string.IsNullOrWhiteSpace(geminiKey))
        {
            throw new InvalidOperationException("Gemini key is not set.");
        }

        await SetCurrentStepAsync(job.Id, "Running AI company insight", cancellationToken);
        var insightDocument = await RunGeminiInsightSearchAsync(geminiKey.Trim(), payload.SearchName, payload.SearchLocation, cancellationToken);

        long? savedInsightId = null;
        if (payload.SaveToDatabase)
        {
            await SetCurrentStepAsync(job.Id, "Saving AI company insight", cancellationToken);
            savedInsightId = await SaveAiCompanyInsightAsync(payload, insightDocument, job.RequestedByUserId, cancellationToken);
        }

        var result = JsonSerializer.Serialize(new
        {
            searchName = payload.SearchName,
            searchLocation = payload.SearchLocation,
            customerId = payload.CustomerId,
            savedInsightId,
            insight = insightDocument.RootElement
        }, JsonDefaults.Options);

        return result;
    }

    private async Task<JsonDocument> RunGeminiInsightSearchAsync(string apiKey, string searchName, string? searchLocation, CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromMinutes(5);
        var prompt = $"""
        Find detailed information about the UK business named "{searchName}" located near postcode "{searchLocation ?? ""}". 
                Include data from Companies House, their official website, social media profiles (LinkedIn, X/Twitter, Facebook, Instagram), and other public sources.
                Identify the main official website and list any relevant auxiliary digital links (e.g., trustpilot, glassdoor, or secondary domains).
                CRITICAL: Try to find financial highlights, specifically Turnover (Revenue) and Employee Count from recent filings or public reports.
                Specifically focus on the SIC codes, company status, and directors.
                Be precise with the Company Number and Registered Address.
        """;

        var requestBody = JsonSerializer.Serialize(new
        {
            contents = new[]
            {
                new
                {
                    role = "user",
                    parts = new[] { new { text = prompt } }
                }
            },
            tools = new[]
            {
                new { google_search = new { } }
            },
            generationConfig = new
            {
                responseMimeType = "application/json",
                responseSchema = new
                {
                    type = "OBJECT",
                    properties = new
                    {
                        companyName = new { type = "STRING" },
                        companyNumber = new { type = "STRING" },
                        registeredAddress = new { type = "STRING" },
                        status = new { type = "STRING" },
                        incorporationDate = new { type = "STRING" },
                        sicCodes = new
                        {
                            type = "ARRAY",
                            items = new { type = "STRING" }
                        },
                        natureOfBusiness = new { type = "STRING" },
                        directors = new
                        {
                            type = "ARRAY",
                            items = new
                            {
                                type = "OBJECT",
                                properties = new
                                {
                                    name = new { type = "STRING" },
                                    role = new { type = "STRING" }
                                }
                            }
                        },
                        lastAccountsDate = new { type = "STRING" },
                        confirmationStatementDate = new { type = "STRING" },
                        turnover = new { type = "STRING" },
                        employeeCount = new { type = "STRING" },
                        website = new { type = "STRING" },
                        digitalLinks = new
                        {
                            type = "ARRAY",
                            items = new
                            {
                                type = "OBJECT",
                                properties = new
                                {
                                    label = new { type = "STRING" },
                                    url = new { type = "STRING" }
                                }
                            }
                        },
                        summary = new { type = "STRING" },
                        sources = new
                        {
                            type = "ARRAY",
                            items = new { type = "STRING" }
                        }
                    },
                    required = new[] { "companyName", "companyNumber", "sicCodes", "summary" }
                }
            },
            systemInstruction = new
            {
                parts = new[]
                {
                    new
                    {
                        text = "You are a professional UK business researcher. You find accurate, up-to-date information about companies in the UK using Google Search. Always verify company numbers and SIC codes. Find as many official digital presence links as possible and always attempt to locate financial data like turnover and employee count."
                    }
                }
            }
        });

        using var request = new HttpRequestMessage(HttpMethod.Post, $"https://generativelanguage.googleapis.com/v1beta/models/{_geminiModel}:generateContent?key={Uri.EscapeDataString(apiKey)}")
        {
            Content = new StringContent(requestBody, Encoding.UTF8, "application/json")
        };

        using var response = await client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var envelope = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var text = envelope.RootElement
            .GetProperty("candidates")[0]
            .GetProperty("content")
            .GetProperty("parts")[0]
            .GetProperty("text")
            .GetString();

        if (string.IsNullOrWhiteSpace(text))
        {
            throw new InvalidOperationException("Gemini returned an empty response.");
        }

        var normalized = StripMarkdownCodeFence(text);
        using var rawDocument = JsonDocument.Parse(normalized);
        return NormalizeInsightDocument(rawDocument);
    }

    private async Task<long> SaveAiCompanyInsightAsync(AiCompanyInsightJobPayload payload, JsonDocument insightDocument, long? requestedByUserId, CancellationToken cancellationToken)
    {
        var companyName = ReadRequiredString(insightDocument.RootElement, "companyName");
        var companyNumber = ReadRequiredString(insightDocument.RootElement, "companyNumber");
        if (string.IsNullOrWhiteSpace(companyName) || string.IsNullOrWhiteSpace(companyNumber))
        {
            throw new InvalidOperationException("Insight JSON must include companyName and companyNumber.");
        }

        var status = ReadOptionalString(insightDocument.RootElement, "status");

        await using var command = db.CreateCommand("""
            insert into paymentsense_core.ai_company_insights (
              search_name,
              search_location,
              company_name,
              company_number,
              status,
              insight_json,
              created_by_user_id
            )
            values (
              @search_name,
              @search_location,
              @company_name,
              @company_number,
              @status,
              @insight_json::jsonb,
              @created_by_user_id
            )
            on conflict (company_number) do update
            set
              search_name = excluded.search_name,
              search_location = excluded.search_location,
              company_name = excluded.company_name,
              status = excluded.status,
              insight_json = excluded.insight_json,
              created_by_user_id = excluded.created_by_user_id,
              updated_at = now()
            returning id
            """);
        command.Parameters.AddWithValue("search_name", payload.SearchName);
        command.Parameters.AddWithValue("search_location", (object?)NullIfBlank(payload.SearchLocation) ?? DBNull.Value);
        command.Parameters.AddWithValue("company_name", companyName);
        command.Parameters.AddWithValue("company_number", companyNumber);
        command.Parameters.AddWithValue("status", (object?)status ?? DBNull.Value);
        command.Parameters.AddWithValue("insight_json", insightDocument.RootElement.GetRawText());
        command.Parameters.AddWithValue("created_by_user_id", (object?)requestedByUserId ?? DBNull.Value);
        var id = (long)(await command.ExecuteScalarAsync(cancellationToken) ?? 0L);

        if (payload.CustomerId is long customerId)
        {
            await LinkAiCompanyInsightToCustomerAsync(customerId, id, cancellationToken);
        }

        return id;
    }

    private async Task LinkAiCompanyInsightToCustomerAsync(long customerId, long insightId, CancellationToken cancellationToken)
    {
        await using var connection = await db.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await using (var deleteCommand = new NpgsqlCommand("""
            delete from paymentsense_core.customer_ai_company_insights
            where customer_id = @customer_id
              and ai_company_insight_id <> @ai_company_insight_id
            """, connection, transaction))
        {
            deleteCommand.Parameters.AddWithValue("customer_id", customerId);
            deleteCommand.Parameters.AddWithValue("ai_company_insight_id", insightId);
            await deleteCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var insertCommand = new NpgsqlCommand("""
            insert into paymentsense_core.customer_ai_company_insights (
              customer_id,
              ai_company_insight_id
            )
            values (
              @customer_id,
              @ai_company_insight_id
            )
            on conflict (customer_id, ai_company_insight_id) do update
            set updated_at = now()
            """, connection, transaction))
        {
            insertCommand.Parameters.AddWithValue("customer_id", customerId);
            insertCommand.Parameters.AddWithValue("ai_company_insight_id", insightId);
            await insertCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    private async Task<string?> LoadAppSettingAsync(string settingKey, CancellationToken cancellationToken)
    {
        await using var command = db.CreateCommand("""
            select value_text
            from paymentsense_core.app_settings
            where setting_key = @setting_key
            """);
        command.Parameters.AddWithValue("setting_key", settingKey);
        return await command.ExecuteScalarAsync(cancellationToken) as string;
    }

    private async Task SetCurrentStepAsync(long jobId, string currentStep, CancellationToken cancellationToken)
    {
        await using var command = db.CreateCommand("""
            update paymentsense_core.queued_jobs
            set current_step = @current_step,
                last_heartbeat_at = now(),
                updated_at = now()
            where id = @id
            """);
        command.Parameters.AddWithValue("id", jobId);
        command.Parameters.AddWithValue("current_step", currentStep);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task EnqueueJobOutboxAsync(long jobId, CancellationToken cancellationToken)
    {
        await using var command = db.CreateCommand("""
            insert into paymentsense_core.job_outbox (job_id, event_type)
            values (@job_id, 'enqueue')
            on conflict do nothing
            """);
        command.Parameters.AddWithValue("job_id", jobId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task CancelQueuedJobAsync(long jobId, CancellationToken cancellationToken)
    {
        await using var command = db.CreateCommand("""
            update paymentsense_core.queued_jobs
            set status = 'cancelled',
                current_step = 'Cancelled',
                completed_at = now(),
                updated_at = now()
            where id = @id
              and removed_at is null
            """);
        command.Parameters.AddWithValue("id", jobId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task MarkOutboxPublishedAsync(long outboxId, CancellationToken cancellationToken)
    {
        await using var command = db.CreateCommand("""
            update paymentsense_core.job_outbox
            set published_at = now(),
                updated_at = now()
            where id = @id
            """);
        command.Parameters.AddWithValue("id", outboxId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task SafeAwaitAsync(Task task)
    {
        try
        {
            await task;
        }
        catch
        {
            // Ignore heartbeat shutdown exceptions.
        }
    }

    private static string StripMarkdownCodeFence(string value)
    {
        var trimmed = value.Trim();
        if (!trimmed.StartsWith("```", StringComparison.Ordinal))
        {
            return trimmed;
        }

        trimmed = Regex.Replace(trimmed, "^```(?:json)?\\s*", "", RegexOptions.IgnoreCase);
        trimmed = Regex.Replace(trimmed, "\\s*```$", "");
        return trimmed.Trim();
    }

    private static JsonDocument NormalizeInsightDocument(JsonDocument document)
    {
        if (document.RootElement.ValueKind == JsonValueKind.Object)
        {
            return JsonDocument.Parse(document.RootElement.GetRawText());
        }

        if (document.RootElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in document.RootElement.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.Object)
                {
                    return JsonDocument.Parse(item.GetRawText());
                }
            }
        }

        throw new InvalidOperationException("Gemini insight response did not contain a JSON object.");
    }

    private static string ReadRequiredString(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.String)
        {
            return string.Empty;
        }

        return property.GetString()?.Trim() ?? string.Empty;
    }

    private static string? ReadOptionalString(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return NullIfBlank(property.GetString());
    }

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

internal sealed record JobOutboxDispatchRow(long OutboxId, long JobId, string Status, bool CancelRequested, bool IsRemoved);
internal sealed record QueuedJobWorkerRow(long Id, string JobType, string PayloadJson, long? RequestedByUserId);
internal sealed record AiCompanyInsightJobPayload(string SearchName, string? SearchLocation, long? CustomerId, bool SaveToDatabase);

internal static class JsonDefaults
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
}
