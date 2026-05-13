using System.Globalization;
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using Npgsql;
using NpgsqlTypes;

var builder = WebApplication.CreateBuilder(args);
const string JobsQueueName = "matchlab.jobs";

builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
        policy
            .SetIsOriginAllowed(origin =>
            {
                if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
                {
                    return false;
                }

                return uri.Scheme is "http" or "https";
            })
            .AllowAnyHeader()
            .AllowAnyMethod());
});

var connectionString =
    builder.Configuration.GetConnectionString("Postgres") ??
    Environment.GetEnvironmentVariable("DATABASE_URL");

if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException("Set ConnectionStrings:Postgres or DATABASE_URL before starting the API.");
}

builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(connectionString));
builder.Services.AddHttpClient();

var app = builder.Build();

app.UseCors("Frontend");

app.MapGet("/health", async (NpgsqlDataSource db) =>
{
    await using var command = db.CreateCommand("select now()");
    var databaseTime = (DateTime) (await command.ExecuteScalarAsync() ?? DateTime.UtcNow);
    return Results.Ok(new HealthResponse("ok", databaseTime));
});

app.MapGet("/api/dashboard", async (NpgsqlDataSource db) =>
{
    const string sql = """
        select
          (select count(*) from paymentsense_raw.search_runs) as search_runs,
          (select count(*) from paymentsense_raw.extracted_records) as extracted_records,
          (select count(*) from paymentsense_core.organisations) as organisations,
          (select count(*) from paymentsense_core.prospects) as prospects,
          (select count(*) from paymentsense_core.customers) as customers,
          (select count(*) from paymentsense_core.match_candidates where match_status = 'candidate') as candidate_matches,
          (select count(*) from paymentsense_core.match_candidates where match_status = 'needs_review') as needs_review_matches
        """;

    await using var command = db.CreateCommand(sql);
    await using var reader = await command.ExecuteReaderAsync();
    await reader.ReadAsync();

    return Results.Ok(new DashboardResponse(
        reader.GetInt64(0),
        reader.GetInt64(1),
        reader.GetInt64(2),
        reader.GetInt64(3),
        reader.GetInt64(4),
        reader.GetInt64(5),
        reader.GetInt64(6)));
});

app.MapGet("/api/activity-events", async (NpgsqlDataSource db, int? limit) =>
{
    var take = Math.Clamp(limit ?? 50, 1, 250);
    return Results.Ok(await LoadActivityEventsAsync(db, take));
});

app.MapGet("/api/settings/gemini", async (NpgsqlDataSource db) =>
{
    var apiKey = await LoadAppSettingAsync(db, "gemini_api_key");
    return Results.Ok(new GeminiSettingResponse(apiKey));
});

app.MapPut("/api/settings/gemini", async (NpgsqlDataSource db, HttpRequest httpRequest, GeminiSettingUpdateRequest request) =>
{
    var value = string.IsNullOrWhiteSpace(request.ApiKey) ? null : request.ApiKey.Trim();
    await SaveAppSettingAsync(db, "gemini_api_key", value);

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "settings.gemini.updated",
        "setting",
        null,
        actor.UserId,
        actor.Name,
        "Gemini key updated",
        value is null ? "Gemini key was cleared." : "Gemini key was updated.",
        false));

    return Results.Ok(new GeminiSettingResponse(value));
});

app.MapGet("/api/ai-company-insights", async (NpgsqlDataSource db) =>
{
    return Results.Ok(await LoadAiCompanyInsightsAsync(db));
});

app.MapPost("/api/ai-company-insights", async (NpgsqlDataSource db, HttpRequest httpRequest, SaveAiCompanyInsightRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.SearchName))
    {
        return Results.BadRequest(new { error = "Search name is required." });
    }

    if (request.Insight.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
    {
        return Results.BadRequest(new { error = "Insight JSON is required." });
    }

    var insight = NormalizeInsightElement(request.Insight);
    var companyName = ReadRequiredString(insight, "companyName");
    var companyNumber = ReadRequiredString(insight, "companyNumber");
    if (string.IsNullOrWhiteSpace(companyName) || string.IsNullOrWhiteSpace(companyNumber))
    {
        return Results.BadRequest(new { error = "Insight JSON must include companyName and companyNumber." });
    }

    var status = ReadOptionalString(insight, "status");
    var actor = await ResolveActivityActorAsync(db, httpRequest);
    if (request.CustomerId is long customerId && !await CustomerExistsAsync(db, customerId))
    {
        return Results.NotFound(new { error = "Customer not found." });
    }

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
    command.Parameters.AddWithValue("search_name", request.SearchName.Trim());
    command.Parameters.AddWithValue("search_location", (object?)NullIfBlank(request.SearchLocation) ?? DBNull.Value);
    command.Parameters.AddWithValue("company_name", companyName);
    command.Parameters.AddWithValue("company_number", companyNumber);
    command.Parameters.AddWithValue("status", (object?)status ?? DBNull.Value);
    command.Parameters.AddWithValue("insight_json", insight.GetRawText());
    command.Parameters.AddWithValue("created_by_user_id", (object?)actor.UserId ?? DBNull.Value);
    var id = (long)(await command.ExecuteScalarAsync() ?? 0L);

    if (request.CustomerId is long linkedCustomerId)
    {
        await LinkAiCompanyInsightToCustomerAsync(db, linkedCustomerId, id);
    }

    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "ai_company_insight.saved",
        "ai_company_insight",
        id,
        actor.UserId,
        actor.Name,
        "AI company insight saved",
        $"{companyName} AI company insight was saved.",
        false));

    return Results.Ok(await LoadAiCompanyInsightByIdAsync(db, id));
});

app.MapPost("/api/ai-company-insights/apply-to-customers", async (NpgsqlDataSource db, HttpRequest httpRequest, SaveAiCompanyInsightRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.SearchName))
    {
        return Results.BadRequest(new { error = "Search name is required." });
    }

    if (request.Insight.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
    {
        return Results.BadRequest(new { error = "Insight JSON is required." });
    }

    var insight = NormalizeInsightElement(request.Insight);
    var companyName = ReadRequiredString(insight, "companyName");
    if (string.IsNullOrWhiteSpace(companyName))
    {
        return Results.BadRequest(new { error = "Insight JSON must include companyName." });
    }

    var sicCodes = ExtractSicCodesFromInsight(insight);
    if (sicCodes.Count == 0)
    {
        return Results.Ok(new { matchedCustomers = 0, addedLinks = 0 });
    }

    var matchingCustomers = await LoadMatchingCustomersForAiInsightAsync(db, companyName, request.SearchLocation);
    if (matchingCustomers.Count == 0)
    {
        return Results.Ok(new { matchedCustomers = 0, addedLinks = 0 });
    }

    var addedLinks = 0;
    foreach (var customerId in matchingCustomers)
    {
        foreach (var sicCode in sicCodes)
        {
            await using var command = db.CreateCommand("""
                insert into paymentsense_core.customer_business_type_links (
                  customer_id,
                  sic_code
                )
                values (
                  @customer_id,
                  @sic_code
                )
                on conflict do nothing
                """);
            command.Parameters.AddWithValue("customer_id", customerId);
            command.Parameters.AddWithValue("sic_code", sicCode);
            addedLinks += await command.ExecuteNonQueryAsync();
        }
    }

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "ai_company_insight.applied_to_customers",
        "ai_company_insight",
        null,
        actor.UserId,
        actor.Name,
        "AI company insight applied to customers",
        $"{companyName} added {sicCodes.Count} SIC code(s) across {matchingCustomers.Count} matching customer(s).",
        false));

    return Results.Ok(new { matchedCustomers = matchingCustomers.Count, addedLinks });
});

app.MapDelete("/api/ai-company-insights/{insightId:long}", async (NpgsqlDataSource db, HttpRequest httpRequest, long insightId) =>
{
    AiCompanyInsightResponse? existing = await LoadAiCompanyInsightByIdAsync(db, insightId);
    if (existing is null)
    {
        return Results.NotFound(new { error = "AI company insight not found." });
    }

    await using var command = db.CreateCommand("""
        delete from paymentsense_core.ai_company_insights
        where id = @id
        """);
    command.Parameters.AddWithValue("id", insightId);
    await command.ExecuteNonQueryAsync();

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "ai_company_insight.deleted",
        "ai_company_insight",
        insightId,
        actor.UserId,
        actor.Name,
        "AI company insight deleted",
        $"{existing.CompanyName} AI company insight was deleted.",
        false));

    return Results.Ok(new { deleted = true });
});

app.MapDelete("/api/customers/{customerId:long}/ai-company-insight", async (NpgsqlDataSource db, HttpRequest httpRequest, long customerId) =>
{
    if (!await CustomerExistsAsync(db, customerId))
    {
        return Results.NotFound(new { error = "Customer not found." });
    }

    await using var command = db.CreateCommand("""
        delete from paymentsense_core.customer_ai_company_insights
        where customer_id = @customer_id
        """);
    command.Parameters.AddWithValue("customer_id", customerId);
    var deleted = await command.ExecuteNonQueryAsync();

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "customer.ai_company_insight.unlinked",
        "customer",
        customerId,
        actor.UserId,
        actor.Name,
        "Customer AI insight removed",
        $"AI insight link was removed from customer {customerId}.",
        false));

    return Results.Ok(new { removed = deleted > 0 });
});

app.MapGet("/api/jobs", async (NpgsqlDataSource db, string? searchText, string? status, string? jobType, bool? includeRemoved) =>
{
    return Results.Ok(await LoadQueuedJobsAsync(db, searchText, status, jobType, includeRemoved == true));
});

app.MapGet("/api/jobs/overview", async (NpgsqlDataSource db, IConfiguration configuration, IHttpClientFactory httpClientFactory) =>
{
    var summary = await LoadQueuedJobSummaryAsync(db);
    var queue = await LoadRabbitQueueMetricsAsync(configuration, httpClientFactory, JobsQueueName);
    return Results.Ok(new JobOverviewResponse(summary, queue));
});

app.MapPost("/api/jobs/ai-company-insight", async (NpgsqlDataSource db, HttpRequest httpRequest, CreateAiCompanyInsightJobRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.SearchName))
    {
        return Results.BadRequest(new { error = "Search name is required." });
    }

    if (request.CustomerId is long customerId && !await CustomerExistsAsync(db, customerId))
    {
        return Results.NotFound(new { error = "Customer not found." });
    }

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    var scheduledFor = ParseDateTimeOrNow(request.ScheduledFor);
    var payload = JsonSerializer.Serialize(new AiCompanyInsightJobPayload(
        request.SearchName.Trim(),
        NullIfBlank(request.SearchLocation),
        request.CustomerId,
        request.SaveToDatabase), JsonDefaults.Options);
    var displayName = $"AI Company Insight: {request.SearchName.Trim()}";
    var jobId = await CreateQueuedJobAsync(db, "ai_company_insight", displayName, payload, actor.UserId, scheduledFor);

    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "job.created",
        "queued_job",
        jobId,
        actor.UserId,
        actor.Name,
        "Queued job created",
        $"{displayName} was queued for {scheduledFor:dd MMM yyyy, HH:mm}.",
        false));

    return Results.Ok(await LoadQueuedJobByIdAsync(db, jobId));
});

app.MapPost("/api/jobs/{jobId:long}/cancel", async (NpgsqlDataSource db, HttpRequest httpRequest, long jobId) =>
{
    var job = await LoadQueuedJobByIdAsync(db, jobId);
    if (job is null || job.RemovedAt is not null)
    {
        return Results.NotFound(new { error = "Job not found." });
    }

    await using var command = db.CreateCommand("""
        update paymentsense_core.queued_jobs
        set
          cancel_requested = true,
          status = case when status = 'running' then 'cancel_requested' else 'cancelled' end,
          current_step = case when status = 'running' then 'Cancellation requested' else 'Cancelled' end,
          completed_at = case when status = 'running' then completed_at else now() end,
          updated_at = now()
        where id = @id
          and removed_at is null
        """);
    command.Parameters.AddWithValue("id", jobId);
    await command.ExecuteNonQueryAsync();

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "job.cancelled",
        "queued_job",
        jobId,
        actor.UserId,
        actor.Name,
        "Queued job cancelled",
        $"{job.DisplayName} was cancelled.",
        false));

    return Results.Ok(await LoadQueuedJobByIdAsync(db, jobId));
});

app.MapPost("/api/jobs/{jobId:long}/retry", async (NpgsqlDataSource db, HttpRequest httpRequest, long jobId) =>
{
    var job = await LoadQueuedJobByIdAsync(db, jobId);
    if (job is null || job.RemovedAt is not null)
    {
        return Results.NotFound(new { error = "Job not found." });
    }

    if (job.Status is "running" or "queued" or "pending" or "cancel_requested")
    {
        return Results.Conflict(new { error = "Only failed, cancelled, or completed jobs can be retried." });
    }

    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    await using (var command = new NpgsqlCommand("""
        update paymentsense_core.queued_jobs
        set
          status = 'pending',
          cancel_requested = false,
          queued_at = null,
          started_at = null,
          completed_at = null,
          last_heartbeat_at = null,
          current_step = null,
          error_text = null,
          updated_at = now()
        where id = @id
        """, connection, transaction))
    {
        command.Parameters.AddWithValue("id", jobId);
        await command.ExecuteNonQueryAsync();
    }

    await using (var command = new NpgsqlCommand("""
        insert into paymentsense_core.job_outbox (job_id, event_type)
        values (@job_id, 'enqueue')
        on conflict do nothing
        """, connection, transaction))
    {
        command.Parameters.AddWithValue("job_id", jobId);
        await command.ExecuteNonQueryAsync();
    }

    await transaction.CommitAsync();

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "job.retried",
        "queued_job",
        jobId,
        actor.UserId,
        actor.Name,
        "Queued job retried",
        $"{job.DisplayName} was retried.",
        false));

    return Results.Ok(await LoadQueuedJobByIdAsync(db, jobId));
});

app.MapDelete("/api/jobs/{jobId:long}", async (NpgsqlDataSource db, HttpRequest httpRequest, long jobId) =>
{
    var job = await LoadQueuedJobByIdAsync(db, jobId);
    if (job is null)
    {
        return Results.NotFound(new { error = "Job not found." });
    }

    if (job.Status is "running" or "cancel_requested")
    {
        return Results.Conflict(new { error = "Cancel the job before removing it." });
    }

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await using var command = db.CreateCommand("""
        update paymentsense_core.queued_jobs
        set removed_at = now(),
            removed_by_user_id = @removed_by_user_id,
            updated_at = now()
        where id = @id
          and removed_at is null
        """);
    command.Parameters.AddWithValue("id", jobId);
    command.Parameters.AddWithValue("removed_by_user_id", (object?)actor.UserId ?? DBNull.Value);
    await command.ExecuteNonQueryAsync();

    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "job.removed",
        "queued_job",
        jobId,
        actor.UserId,
        actor.Name,
        "Queued job removed",
        $"{job.DisplayName} was removed from the jobs list.",
        false));

    return Results.Ok(new { removed = true });
});

app.MapGet("/api/search-runs", async (NpgsqlDataSource db, int? limit) =>
{
    var take = Math.Clamp(limit ?? 250, 1, 1000);
    const string sql = """
        select id, query_text, source_url, executed_at, completed_at, counts::text, notes
        from paymentsense_raw.search_runs
        order by executed_at desc
        limit @limit
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("limit", take);

    var rows = new List<SearchRunResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new SearchRunResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetNullableString(2),
            reader.GetDateTime(3),
            reader.IsDBNull(4) ? null : reader.GetDateTime(4),
            reader.GetString(5),
            reader.GetNullableString(6)));
    }

    return Results.Ok(rows);
});

app.MapGet("/api/prospects", async (NpgsqlDataSource db) =>
{
    const string sql = """
        select
          p.id,
          p.prospect_id,
          o.display_name,
          p.created_at,
          p.created_on,
          p.owner_name,
          p.has_paymentsense_customer_match,
          c.full_name,
          c.email,
          a.normalized_postcode,
          p.channel,
          p.origin,
          a.line1,
          a.town,
          a.county,
          c.phone,
          exists (
            select 1
            from paymentsense_raw.extracted_records r
            where r.record_type = 'prospect_detail'
              and r.external_id = p.prospect_id
              and r.raw_payload->>'extractorVersion' = '2'
          ) as has_stored_detail,
          exists (
            select 1
            from paymentsense_core.lead_prospects lp
            where lp.prospect_id = p.id
          ) or exists (
            select 1
            from paymentsense_core.leads l
            where l.primary_prospect_id = p.id
          ) as has_lead
        from paymentsense_core.prospects p
        join paymentsense_core.organisations o on o.id = p.organisation_id
        left join lateral (
          select full_name, email, phone
          from paymentsense_core.contacts
          where organisation_id = o.id
          order by id
          limit 1
        ) c on true
        left join lateral (
          select line1, town, county, normalized_postcode
          from paymentsense_core.addresses
          where organisation_id = o.id
          order by id
          limit 1
        ) a on true
        order by p.updated_at desc
        """;

    await using var command = db.CreateCommand(sql);

    var rows = new List<ProspectResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new ProspectResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetDateTime(3),
            reader.IsDBNull(4) ? null : reader.GetFieldValue<DateOnly>(4),
            reader.GetNullableString(5),
            reader.IsDBNull(6) ? null : reader.GetBoolean(6),
            reader.GetNullableString(7),
            reader.GetNullableString(8),
            reader.GetNullableString(9),
            reader.GetNullableString(10),
            reader.GetNullableString(11),
            reader.GetNullableString(12),
            reader.GetNullableString(13),
            reader.GetNullableString(14),
            reader.GetNullableString(15),
            reader.GetBoolean(16),
            reader.GetBoolean(17)));
    }

    return Results.Ok(rows);
});

app.MapGet("/api/customers", async (NpgsqlDataSource db, HttpRequest httpRequest) =>
{
    var actor = await ResolveActivityActorAsync(db, httpRequest);
    const string sql = """
        with first_addresses as (
          select distinct on (organisation_id)
            organisation_id,
            line1,
            normalized_postcode
          from paymentsense_core.addresses
          order by organisation_id, id
        ),
        actor_bookmarks as (
          select distinct customer_id
          from paymentsense_core.customer_bookmarks
          where user_id = @actor_user_id
        ),
        any_bookmarks as (
          select distinct customer_id
          from paymentsense_core.customer_bookmarks
        ),
        note_flags as (
          select distinct customer_id
          from paymentsense_core.customer_notes
        ),
        match_summary as (
          select
            customer_id,
            count(distinct prospect_id)::int as attached_prospect_count
          from paymentsense_core.match_candidates
          group by customer_id
        ),
        lead_flags as (
          select distinct customer_id
          from paymentsense_core.leads
        ),
        ai_link_flags as (
          select distinct customer_id
          from paymentsense_core.customer_ai_company_insights
        ),
        ai_job_flags as (
          select distinct ((payload_json ->> 'customerId')::bigint) as customer_id
          from paymentsense_core.queued_jobs
          where removed_at is null
            and job_type = 'ai_company_insight'
            and status in ('pending', 'queued', 'running', 'cancel_requested')
            and jsonb_typeof(payload_json) = 'object'
            and payload_json ? 'customerId'
            and (payload_json ->> 'customerId') ~ '^\d+$'
        )
        select
          c.id,
          c.customer_kind,
          c.customer_ref,
          c.mid,
          c.created_at,
          o.display_name,
          c.trading_name,
          a.line1,
          a.normalized_postcode,
          c.start_date,
          c.status,
          c.suppression_reason,
          c.region_id,
          r.name,
          c.customer_activity_status_id,
          cas.name,
          c.customer_value_type_id,
          cvt.label,
          cvt.decimal_value,
          cvt.shield_order,
          cvt.image_file_name,
          c.assigned_user_id,
          u.full_name,
          (ab.customer_id is not null) as is_bookmarked,
          (anyb.customer_id is not null) as has_any_bookmark,
          (nf.customer_id is not null) as has_notes,
          exists (
            select 1
            from paymentsense_core.owned_checklist oc
            where oc.expires_at > now()
              and (
                (
                  oc.normalized_contact_email is not null
                  and exists (
                    select 1
                    from paymentsense_core.contacts ct
                    where ct.organisation_id = o.id
                      and ct.normalized_email = oc.normalized_contact_email
                  )
                )
                or (
                  oc.normalized_business_name is not null
                  and char_length(oc.normalized_business_name) >= 6
                  and (
                    oc.normalized_business_name = o.normalized_name
                    or oc.normalized_business_name = c.normalized_trading_name
                    or o.normalized_name like '%' || oc.normalized_business_name || '%'
                    or oc.normalized_business_name like '%' || o.normalized_name || '%'
                    or (
                      c.normalized_trading_name is not null
                      and (
                        c.normalized_trading_name like '%' || oc.normalized_business_name || '%'
                        or oc.normalized_business_name like '%' || c.normalized_trading_name || '%'
                      )
                    )
                  )
                )
                or (
                  oc.normalized_contact_name is not null
                  and char_length(oc.normalized_contact_name) >= 6
                  and exists (
                    select 1
                    from paymentsense_core.contacts ct
                    where ct.organisation_id = o.id
                      and ct.normalized_name is not null
                      and (
                        ct.normalized_name = oc.normalized_contact_name
                        or ct.normalized_name like '%' || oc.normalized_contact_name || '%'
                        or oc.normalized_contact_name like '%' || ct.normalized_name || '%'
                      )
                  )
                )
              )
          ) as has_owned_checklist_match,
          (ms.customer_id is not null) as has_stored_matches,
          coalesce(ms.attached_prospect_count, 0) as attached_prospect_count,
          (lf.customer_id is not null) as has_lead,
          (aif.customer_id is not null) as has_ai_insight,
          (ajf.customer_id is not null) as has_ai_insight_job_scheduled
        from paymentsense_core.customers c
        join paymentsense_core.organisations o on o.id = c.organisation_id
        left join paymentsense_core.regions r on r.id = c.region_id
        left join paymentsense_core.customer_activity_statuses cas on cas.id = c.customer_activity_status_id
        left join paymentsense_core.customer_value_types cvt on cvt.id = c.customer_value_type_id
        left join paymentsense_core.users u on u.id = c.assigned_user_id
        left join first_addresses a on a.organisation_id = o.id
        left join actor_bookmarks ab on ab.customer_id = c.id
        left join any_bookmarks anyb on anyb.customer_id = c.id
        left join note_flags nf on nf.customer_id = c.id
        left join match_summary ms on ms.customer_id = c.id
        left join lead_flags lf on lf.customer_id = c.id
        left join ai_link_flags aif on aif.customer_id = c.id
        left join ai_job_flags ajf on ajf.customer_id = c.id
        order by c.updated_at desc
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("actor_user_id", (object?) actor.UserId ?? DBNull.Value);
    command.CommandTimeout = 120;

    var rows = new List<CustomerResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new CustomerResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetNullableString(2),
            reader.GetNullableString(3),
            reader.GetDateTime(4),
            reader.GetString(5),
            reader.GetNullableString(6),
            reader.GetNullableString(7),
            reader.GetNullableString(8),
            reader.IsDBNull(9) ? null : reader.GetFieldValue<DateOnly>(9),
            TextNormalizer.NormalizeStatus(reader.GetNullableString(10)),
            reader.GetNullableString(11),
            reader.IsDBNull(12) ? null : reader.GetInt64(12),
            reader.GetNullableString(13),
            reader.IsDBNull(14) ? null : reader.GetInt64(14),
            reader.GetNullableString(15),
            reader.IsDBNull(16) ? null : reader.GetInt64(16),
            reader.GetNullableString(17),
            reader.IsDBNull(18) ? null : reader.GetDecimal(18),
            reader.IsDBNull(19) ? null : reader.GetInt32(19),
            reader.GetNullableString(20),
            reader.IsDBNull(21) ? null : reader.GetInt64(21),
            reader.GetNullableString(22),
            reader.GetBoolean(23),
            reader.GetBoolean(24),
            reader.GetBoolean(25),
            reader.GetBoolean(26),
            reader.GetBoolean(27),
            reader.GetInt32(28),
            reader.GetBoolean(29),
            reader.GetBoolean(30),
            reader.GetBoolean(31)));
    }

    return Results.Ok(rows);
});

app.MapPost("/api/customers/{customerId:long}/bookmark", async (NpgsqlDataSource db, HttpRequest httpRequest, long customerId) =>
{
    var actor = await ResolveActivityActorAsync(db, httpRequest);
    if (!actor.UserId.HasValue)
    {
        return Results.BadRequest(new { error = "Select a current user before bookmarking customers." });
    }

    if (!await CustomerExistsAsync(db, customerId))
    {
        return Results.NotFound(new { error = "Customer not found." });
    }

    await using var command = db.CreateCommand("""
        insert into paymentsense_core.customer_bookmarks (user_id, customer_id)
        values (@user_id, @customer_id)
        on conflict do nothing
        """);
    command.Parameters.AddWithValue("user_id", actor.UserId.Value);
    command.Parameters.AddWithValue("customer_id", customerId);
    await command.ExecuteNonQueryAsync();

    return Results.Ok(new { bookmarked = true });
});

app.MapDelete("/api/customers/{customerId:long}/bookmark", async (NpgsqlDataSource db, HttpRequest httpRequest, long customerId) =>
{
    var actor = await ResolveActivityActorAsync(db, httpRequest);
    if (!actor.UserId.HasValue)
    {
        return Results.BadRequest(new { error = "Select a current user before changing bookmarks." });
    }

    await using var command = db.CreateCommand("""
        delete from paymentsense_core.customer_bookmarks
        where user_id = @user_id
          and customer_id = @customer_id
        """);
    command.Parameters.AddWithValue("user_id", actor.UserId.Value);
    command.Parameters.AddWithValue("customer_id", customerId);
    await command.ExecuteNonQueryAsync();

    return Results.Ok(new { bookmarked = false });
});

app.MapDelete("/api/customers/bookmarks", async (NpgsqlDataSource db, HttpRequest httpRequest) =>
{
    var actor = await ResolveActivityActorAsync(db, httpRequest);
    if (!actor.UserId.HasValue)
    {
        return Results.BadRequest(new { error = "Select a current user before clearing bookmarks." });
    }

    await using var command = db.CreateCommand("""
        delete from paymentsense_core.customer_bookmarks
        where user_id = @user_id
        """);
    command.Parameters.AddWithValue("user_id", actor.UserId.Value);
    var removed = await command.ExecuteNonQueryAsync();

    return Results.Ok(new { cleared = removed });
});

app.MapGet("/api/customers/{customerId:long}/matches", async (NpgsqlDataSource db, long customerId) =>
{
    var customer = await LoadCustomerMatchSourceAsync(db, customerId);
    if (customer is null)
    {
        return Results.NotFound(new { error = "Customer not found." });
    }

    var existingLead = await LoadLeadSummaryByCustomerIdAsync(db, customerId);
    var commercials = await LoadCustomerCommercialsAsync(db, customerId);
    var customerBusinessTypes = await LoadCustomerBusinessTypesAsync(db, customerId);
    var aiInsight = await LoadCustomerAiCompanyInsightAsync(db, customerId);
    var storedMatches = await LoadCustomerMatchesAsync(db, customerId, generatedNow: false);
    if (storedMatches.Count > 0)
    {
        return Results.Ok(new CustomerMatchResponse(customerId, false, storedMatches, existingLead, customer.SuppressionReason, commercials, customerBusinessTypes, aiInsight));
    }

    var generatedMatches = await GenerateCustomerMatchesAsync(db, customer);
    if (generatedMatches.Count > 0)
    {
        await SaveCustomerMatchesAsync(db, customerId, generatedMatches);
    }

    var responseMatches = generatedMatches.Count > 0
        ? await LoadCustomerMatchesAsync(db, customerId, generatedNow: true)
        : Array.Empty<CustomerProspectMatchResponse>();

    return Results.Ok(new CustomerMatchResponse(customerId, true, responseMatches, existingLead, customer.SuppressionReason, commercials, customerBusinessTypes, aiInsight));
});

app.MapPut("/api/customers/{customerId:long}/business-types", async (NpgsqlDataSource db, HttpRequest httpRequest, long customerId, CustomerBusinessTypeSelectionUpdateRequest request) =>
{
    var customer = await LoadCustomerActivitySummaryAsync(db, customerId);
    if (customer is null)
    {
        return Results.NotFound(new { error = "Customer not found." });
    }

    var parsedSelections = await ParseCustomerBusinessTypeSelectionsAsync(db, request.Keys ?? Array.Empty<string>());
    if (!parsedSelections.Success)
    {
        return Results.BadRequest(new { error = parsedSelections.ErrorMessage ?? "One or more business types were invalid." });
    }

    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    await using (var deleteCommand = connection.CreateCommand())
    {
        deleteCommand.Transaction = transaction;
        deleteCommand.CommandText = """
            delete from paymentsense_core.customer_business_type_links
            where customer_id = @customer_id
            """;
        deleteCommand.Parameters.AddWithValue("customer_id", customerId);
        await deleteCommand.ExecuteNonQueryAsync();
    }

    foreach (var selection in parsedSelections.Selections)
    {
        await using var insertCommand = connection.CreateCommand();
        insertCommand.Transaction = transaction;
        insertCommand.CommandText = """
            insert into paymentsense_core.customer_business_type_links (
              customer_id,
              business_type_id,
              sic_code
            )
            values (
              @customer_id,
              @business_type_id,
              @sic_code
            )
            """;
        insertCommand.Parameters.AddWithValue("customer_id", customerId);
        insertCommand.Parameters.AddWithValue("business_type_id", (object?)selection.BusinessTypeId ?? DBNull.Value);
        insertCommand.Parameters.AddWithValue("sic_code", (object?)selection.SicCode ?? DBNull.Value);
        await insertCommand.ExecuteNonQueryAsync();
    }

    await transaction.CommitAsync();

    var selectedBusinessTypes = await LoadCustomerBusinessTypesAsync(db, customerId);
    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "customer.business_types.updated",
        "customer",
        customerId,
        actor.UserId,
        actor.Name,
        "Customer business types updated",
        selectedBusinessTypes.Count == 0
            ? $"{FormatCustomerLabel(customer)} business types were cleared."
            : $"{FormatCustomerLabel(customer)} business types set to {string.Join(", ", selectedBusinessTypes.Select(row => row.Name))}.",
        false));

    return Results.Ok(selectedBusinessTypes);
});

app.MapGet("/api/customers/{customerId:long}/commercials", async (NpgsqlDataSource db, long customerId) =>
{
    var customerExists = await CustomerExistsAsync(db, customerId);
    if (!customerExists)
    {
        return Results.NotFound(new { error = "Customer not found." });
    }

    return Results.Ok(await LoadCustomerCommercialsAsync(db, customerId));
});

app.MapPatch("/api/customers/{customerId:long}/commercials", async (NpgsqlDataSource db, long customerId, CustomerCommercialsUpdateRequest request) =>
{
    var customerExists = await CustomerExistsAsync(db, customerId);
    if (!customerExists)
    {
        return Results.NotFound(new { error = "Customer not found." });
    }

    if (request.ValuePeriod is not null && request.ValuePeriod is not ("monthly" or "yearly"))
    {
        return Results.BadRequest(new { error = "Value period must be monthly or yearly." });
    }

    var currentChargePercent = request.CurrentChargePercent;
    var proposedChargePercent = request.ProposedChargePercent;
    var creditCardValue = request.CreditCardValue;

    if (currentChargePercent is < 0 or > 100 || proposedChargePercent is < 0 or > 100)
    {
        return Results.BadRequest(new { error = "Percentages must be between 0 and 100." });
    }

    if (creditCardValue is < 0)
    {
        return Results.BadRequest(new { error = "Credit card value cannot be negative." });
    }

    var customerValueTypeId = request.CustomerValueTypeId is > 0 ? request.CustomerValueTypeId : null;
    if (customerValueTypeId.HasValue && !await CustomerValueTypeExistsAsync(db, customerValueTypeId.Value))
    {
        return Results.BadRequest(new { error = "Customer value type not found." });
    }

    await using var command = db.CreateCommand("""
        insert into paymentsense_core.customer_commercials (
          customer_id,
          credit_card_value,
          value_period,
          current_charge_percent,
          proposed_charge_percent
        )
        values (
          @customer_id,
          @credit_card_value,
          @value_period,
          @current_charge_percent,
          @proposed_charge_percent
        )
        on conflict (customer_id) do update
        set credit_card_value = excluded.credit_card_value,
            value_period = excluded.value_period,
            current_charge_percent = excluded.current_charge_percent,
            proposed_charge_percent = excluded.proposed_charge_percent,
            updated_at = now()
        """);
    command.Parameters.AddWithValue("customer_id", customerId);
    command.Parameters.AddWithValue("credit_card_value", (object?)creditCardValue ?? DBNull.Value);
    command.Parameters.AddWithValue("value_period", (object?)request.ValuePeriod ?? DBNull.Value);
    command.Parameters.AddWithValue("current_charge_percent", (object?)currentChargePercent ?? DBNull.Value);
    command.Parameters.AddWithValue("proposed_charge_percent", (object?)proposedChargePercent ?? DBNull.Value);
    await command.ExecuteNonQueryAsync();

    await using (var customerCommand = db.CreateCommand("""
        update paymentsense_core.customers
        set customer_value_type_id = @customer_value_type_id,
            updated_at = now()
        where id = @customer_id
        """))
    {
        customerCommand.Parameters.AddWithValue("customer_value_type_id", (object?)customerValueTypeId ?? DBNull.Value);
        customerCommand.Parameters.AddWithValue("customer_id", customerId);
        await customerCommand.ExecuteNonQueryAsync();
    }

    return Results.Ok(await LoadCustomerCommercialsAsync(db, customerId));
});

app.MapPatch("/api/customers/{customerId:long}/assigned-user", async (NpgsqlDataSource db, HttpRequest httpRequest, long customerId, CustomerAssignedUserUpdateRequest request) =>
{
    var customer = await LoadCustomerActivitySummaryAsync(db, customerId);
    if (customer is null)
    {
        return Results.NotFound(new { error = "Customer not found." });
    }

    string? assignedUserName = null;
    if (request.AssignedUserId.HasValue)
    {
        await using var userCommand = db.CreateCommand("""
            select full_name
            from paymentsense_core.users
            where id = @user_id
            """);
        userCommand.Parameters.AddWithValue("user_id", request.AssignedUserId.Value);
        assignedUserName = (string?) await userCommand.ExecuteScalarAsync();
        if (assignedUserName is null)
        {
            return Results.BadRequest(new { error = "User not found." });
        }
    }

    await using (var command = db.CreateCommand("""
        update paymentsense_core.customers
        set assigned_user_id = @assigned_user_id,
            updated_at = now()
        where id = @customer_id
        """))
    {
        command.Parameters.AddWithValue("assigned_user_id", (object?)request.AssignedUserId ?? DBNull.Value);
        command.Parameters.AddWithValue("customer_id", customerId);
        await command.ExecuteNonQueryAsync();
    }

    if (customer.AssignedUserId != request.AssignedUserId)
    {
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "customer.assignment.updated",
            "customer",
            customerId,
            actor.UserId,
            actor.Name,
            request.AssignedUserId.HasValue ? "Customer assigned" : "Customer unassigned",
            request.AssignedUserId.HasValue
                ? $"{FormatCustomerLabel(customer)} assigned to {assignedUserName ?? "Unknown user"}."
                : $"{FormatCustomerLabel(customer)} was unassigned.",
            true));
    }

    return Results.Ok(new { assignedUserId = request.AssignedUserId, assignedUserName });
});

app.MapPatch("/api/customers/{customerId:long}/activity-status", async (NpgsqlDataSource db, HttpRequest httpRequest, long customerId, CustomerActivityStatusAssignmentUpdateRequest request) =>
{
    var customer = await LoadCustomerActivitySummaryAsync(db, customerId);
    if (customer is null)
    {
        return Results.NotFound(new { error = "Customer not found." });
    }

    string? statusName = null;
    if (request.CustomerActivityStatusId.HasValue)
    {
        await using var statusCommand = db.CreateCommand("""
            select name
            from paymentsense_core.customer_activity_statuses
            where id = @status_id
            """);
        statusCommand.Parameters.AddWithValue("status_id", request.CustomerActivityStatusId.Value);
        statusName = (string?)await statusCommand.ExecuteScalarAsync();
        if (statusName is null)
        {
            return Results.BadRequest(new { error = "Customer activity status not found." });
        }
    }

    await using (var command = db.CreateCommand("""
        update paymentsense_core.customers
        set customer_activity_status_id = @status_id,
            updated_at = now()
        where id = @customer_id
        """))
    {
        command.Parameters.AddWithValue("status_id", (object?)request.CustomerActivityStatusId ?? DBNull.Value);
        command.Parameters.AddWithValue("customer_id", customerId);
        await command.ExecuteNonQueryAsync();
    }

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "customer.activity_status.updated",
        "customer",
        customerId,
        actor.UserId,
        actor.Name,
        "Customer activity status updated",
        statusName is null
            ? $"{FormatCustomerLabel(customer)} activity status was cleared."
            : $"{FormatCustomerLabel(customer)} activity status set to {statusName}.",
        true));

    return Results.Ok(new { customerActivityStatusId = request.CustomerActivityStatusId, customerActivityStatusName = statusName });
});

app.MapPatch("/api/customers/{customerId:long}/suppression", async (NpgsqlDataSource db, HttpRequest httpRequest, long customerId, CustomerSuppressionUpdateRequest request) =>
{
    var normalized = string.IsNullOrWhiteSpace(request.SuppressionReason) ? null : request.SuppressionReason.Trim();
    if (request.UpdateSuppression && normalized is not null)
    {
        var allowed = new[]
        {
            "Unsubscribed",
            "complaint",
            "bounced",
            "do-not-contact",
            "existing customer(not ours)"
        };

        if (!allowed.Contains(normalized, StringComparer.OrdinalIgnoreCase))
        {
            return Results.BadRequest(new { error = "Invalid suppression reason." });
        }
    }

    if (request.CurrentChargePercent is < 0 or > 100 || request.ProposedChargePercent is < 0 or > 100)
    {
        return Results.BadRequest(new { error = "Percentages must be between 0 and 100." });
    }

    if (request.CreditCardValue is < 0)
    {
        return Results.BadRequest(new { error = "Credit card value cannot be negative." });
    }

    var customerValueTypeId = request.CustomerValueTypeId is > 0 ? request.CustomerValueTypeId : null;
    if (customerValueTypeId.HasValue && !await CustomerValueTypeExistsAsync(db, customerValueTypeId.Value))
    {
        return Results.BadRequest(new { error = "Customer value type not found." });
    }

    var customer = await LoadCustomerActivitySummaryAsync(db, customerId);
    if (customer is null)
    {
        return Results.NotFound(new { error = "Customer not found." });
    }

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    var shouldUpdateCommercialFields =
        request.CreditCardValue.HasValue ||
        request.CurrentChargePercent.HasValue ||
        request.ProposedChargePercent.HasValue ||
        request.ValuePeriod is not null;
    var shouldLoadExistingCommercials = shouldUpdateCommercialFields || request.UpdateCustomerValueType;
    var existingCommercials = shouldLoadExistingCommercials
        ? await LoadCustomerCommercialsAsync(db, customerId)
        : null;

    if (request.UpdateSuppression)
    {
        await using var command = db.CreateCommand("""
            update paymentsense_core.customers
            set suppression_reason = @suppression_reason,
                updated_at = now()
            where id = @customer_id
            """);
        command.Parameters.AddWithValue("suppression_reason", (object?)normalized ?? DBNull.Value);
        command.Parameters.AddWithValue("customer_id", customerId);
        await command.ExecuteNonQueryAsync();
    }

    if (shouldUpdateCommercialFields)
    {
        if (request.ValuePeriod is not null && request.ValuePeriod is not ("monthly" or "yearly"))
        {
            return Results.BadRequest(new { error = "Value period must be monthly or yearly." });
        }

        await using var command = db.CreateCommand("""
            insert into paymentsense_core.customer_commercials (
              customer_id,
              credit_card_value,
              value_period,
              current_charge_percent,
              proposed_charge_percent
            )
            values (
              @customer_id,
              @credit_card_value,
              @value_period,
              @current_charge_percent,
              @proposed_charge_percent
            )
            on conflict (customer_id) do update
            set credit_card_value = excluded.credit_card_value,
                value_period = excluded.value_period,
                current_charge_percent = excluded.current_charge_percent,
                proposed_charge_percent = excluded.proposed_charge_percent,
                updated_at = now()
            """);
        command.Parameters.AddWithValue("customer_id", customerId);
        command.Parameters.AddWithValue("credit_card_value", (object?)request.CreditCardValue ?? DBNull.Value);
        command.Parameters.AddWithValue("value_period", (object?)request.ValuePeriod ?? DBNull.Value);
        command.Parameters.AddWithValue("current_charge_percent", (object?)request.CurrentChargePercent ?? DBNull.Value);
        command.Parameters.AddWithValue("proposed_charge_percent", (object?)request.ProposedChargePercent ?? DBNull.Value);
        await command.ExecuteNonQueryAsync();
    }

    if (request.UpdateCustomerValueType)
    {
        await using var customerValueCommand = db.CreateCommand("""
            update paymentsense_core.customers
            set customer_value_type_id = @customer_value_type_id,
                updated_at = now()
            where id = @customer_id
            """);
        customerValueCommand.Parameters.AddWithValue("customer_value_type_id", (object?)customerValueTypeId ?? DBNull.Value);
        customerValueCommand.Parameters.AddWithValue("customer_id", customerId);
        await customerValueCommand.ExecuteNonQueryAsync();
    }

    if (request.UpdateSuppression && !string.Equals(customer.SuppressionReason, normalized, StringComparison.OrdinalIgnoreCase))
    {
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "customer.suppression.updated",
            "customer",
            customerId,
            actor.UserId,
            actor.Name,
            "Customer suppression updated",
            $"{FormatCustomerLabel(customer)} suppression set to {(string.IsNullOrWhiteSpace(normalized) ? "none" : normalized)}.",
            true));
    }

    if (shouldUpdateCommercialFields && !CustomerCommercialsMatch(existingCommercials, request))
    {
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "customer.commercials.updated",
            "customer",
            customerId,
            actor.UserId,
            actor.Name,
            "Customer commercials updated",
            $"Commercials updated for {FormatCustomerLabel(customer)}.",
            false));
    }

    if (request.UpdateCustomerValueType && existingCommercials?.CustomerValueTypeId != customerValueTypeId)
    {
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "customer.value_type.updated",
            "customer",
            customerId,
            actor.UserId,
            actor.Name,
            "Customer value type updated",
            customerValueTypeId.HasValue
                ? $"{FormatCustomerLabel(customer)} customer value type updated."
                : $"{FormatCustomerLabel(customer)} customer value type cleared.",
            false));
    }

    return Results.Ok(new
    {
        suppressionReason = request.UpdateSuppression ? normalized : null,
        commercials = await LoadCustomerCommercialsAsync(db, customerId)
    });
});

app.MapPost("/api/customers/region-assignments", async (NpgsqlDataSource db, HttpRequest httpRequest, CustomerRegionAssignmentsUpdateRequest request) =>
{
    var assignments = (request.Assignments ?? Array.Empty<CustomerRegionAssignmentItem>())
        .GroupBy(item => item.CustomerId)
        .Select(group => group.Last())
        .ToArray();

    if (assignments.Length == 0)
    {
        return Results.BadRequest(new { error = "Select at least one customer." });
    }

    var customerIds = assignments.Select(item => item.CustomerId).ToArray();
    var requestedRegionIds = assignments
        .Where(item => item.RegionId.HasValue)
        .Select(item => item.RegionId!.Value)
        .Distinct()
        .ToArray();

    var customers = new Dictionary<long, (string EntityName, string? CustomerRef, string? Mid, long? RegionId, string? RegionName)>();
    await using (var customerCommand = db.CreateCommand("""
        select c.id, o.display_name, c.customer_ref, c.mid, c.region_id, r.name
        from paymentsense_core.customers c
        join paymentsense_core.organisations o on o.id = c.organisation_id
        left join paymentsense_core.regions r on r.id = c.region_id
        where c.id = any(@customer_ids)
        """))
    {
        customerCommand.Parameters.AddWithValue("customer_ids", customerIds);
        await using var reader = await customerCommand.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            customers[reader.GetInt64(0)] = (
                reader.GetString(1),
                reader.GetNullableString(2),
                reader.GetNullableString(3),
                reader.IsDBNull(4) ? null : reader.GetInt64(4),
                reader.GetNullableString(5));
        }
    }

    if (customers.Count != customerIds.Length)
    {
        return Results.NotFound(new { error = "One or more customers could not be found." });
    }

    var regionsById = new Dictionary<long, string>();
    if (requestedRegionIds.Length > 0)
    {
        await using var regionCommand = db.CreateCommand("""
            select id, name
            from paymentsense_core.regions
            where id = any(@region_ids)
            """);
        regionCommand.Parameters.AddWithValue("region_ids", requestedRegionIds);
        await using var regionReader = await regionCommand.ExecuteReaderAsync();
        while (await regionReader.ReadAsync())
        {
            regionsById[regionReader.GetInt64(0)] = regionReader.GetString(1);
        }

        if (regionsById.Count != requestedRegionIds.Length)
        {
            return Results.BadRequest(new { error = "One or more selected regions could not be found." });
        }
    }

    var results = new List<CustomerRegionAssignmentResult>(assignments.Length);
    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    foreach (var assignment in assignments)
    {
        await using var updateCommand = new NpgsqlCommand("""
            update paymentsense_core.customers
            set region_id = @region_id,
                updated_at = now()
            where id = @customer_id
            """, connection, transaction);
        updateCommand.Parameters.AddWithValue("region_id", (object?)assignment.RegionId ?? DBNull.Value);
        updateCommand.Parameters.AddWithValue("customer_id", assignment.CustomerId);
        await updateCommand.ExecuteNonQueryAsync();

        var existing = customers[assignment.CustomerId];
        results.Add(new CustomerRegionAssignmentResult(
            assignment.CustomerId,
            existing.RegionId,
            existing.RegionName,
            assignment.RegionId,
            assignment.RegionId.HasValue ? regionsById[assignment.RegionId.Value] : null));
    }

    await transaction.CommitAsync();

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "customer.region.assignment.updated",
        "customer",
        null,
        actor.UserId,
        actor.Name,
        "Customer regions updated",
        $"Updated region assignment for {results.Count} customer{(results.Count == 1 ? "" : "s")}.",
        true));

    return Results.Ok(results);
});

app.MapGet("/api/customers/{customerId:long}/notes", async (NpgsqlDataSource db, long customerId) =>
{
    if (!await CustomerExistsAsync(db, customerId))
    {
        return Results.NotFound(new { error = "Customer not found." });
    }

    return Results.Ok(await LoadCustomerNotesAsync(db, customerId));
});

app.MapGet("/api/customers/{customerId:long}/owned-checklist", async (NpgsqlDataSource db, long customerId) =>
{
    if (!await CustomerExistsAsync(db, customerId))
    {
        return Results.NotFound(new { error = "Customer not found." });
    }

    await CleanupExpiredOwnedChecklistAsync(db);
    return Results.Ok(await LoadOwnedChecklistMatchesAsync(db, customerId));
});

app.MapPost("/api/customers/{customerId:long}/notes", async (NpgsqlDataSource db, HttpRequest httpRequest, long customerId, CustomerNoteCreateRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.NoteText))
    {
        return Results.BadRequest(new { error = "Note text is required." });
    }

    var customer = await LoadCustomerActivitySummaryAsync(db, customerId);
    if (customer is null)
    {
        return Results.NotFound(new { error = "Customer not found." });
    }

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    var createdAt = DateTime.TryParse(request.CreatedAt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var parsedCreatedAt)
        ? parsedCreatedAt
        : DateTime.UtcNow;

    await using var command = db.CreateCommand("""
        insert into paymentsense_core.customer_notes (
          customer_id,
          note_text,
          created_by_user_id,
          created_at
        )
        values (
          @customer_id,
          @note_text,
          @created_by_user_id,
          @created_at
        )
        """);
    command.Parameters.AddWithValue("customer_id", customerId);
    command.Parameters.AddWithValue("note_text", request.NoteText.Trim());
    command.Parameters.AddWithValue("created_by_user_id", (object?)actor.UserId ?? DBNull.Value);
    command.Parameters.AddWithValue("created_at", createdAt);
    await command.ExecuteNonQueryAsync();

    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "customer.note.added",
        "customer",
        customerId,
        actor.UserId,
        actor.Name,
        "Customer note added",
        $"Added a note to {FormatCustomerLabel(customer)}.",
        false));

    return Results.Ok(await LoadCustomerNotesAsync(db, customerId));
});

app.MapPost("/api/customers/{customerId:long}/lead", async (NpgsqlDataSource db, HttpRequest httpRequest, long customerId) =>
{
    var existingLead = await LoadLeadSummaryByCustomerIdAsync(db, customerId);
    if (existingLead is not null)
    {
        return Results.Ok(existingLead);
    }

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    var lead = await CreateLeadFromCustomerAsync(db, customerId, actor.UserId);
    if (lead is null)
    {
        return Results.BadRequest(new { error = "A lead needs at least one matched prospect before it can be created." });
    }

    var customer = await LoadCustomerActivitySummaryAsync(db, customerId);
    if (customer is not null)
    {
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "lead.created",
            "lead",
            lead.Id,
            actor.UserId,
            actor.Name,
            "Lead created",
            $"{FormatCustomerLabel(customer)} was turned into Lead #{lead.Id}.",
            true));
    }

    return Results.Ok(lead);
});

app.MapPost("/api/customers/{customerId:long}/prospects/use", async (NpgsqlDataSource db, HttpRequest httpRequest, long customerId, ProspectSearchRowInsertRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.ProspectId))
    {
        return Results.BadRequest(new { error = "ProspectId is required." });
    }

    var customer = await LoadCustomerActivitySummaryAsync(db, customerId);
    if (customer is null)
    {
        return Results.NotFound(new { error = "Customer not found." });
    }

    var row = new LiveProspectRow(
        request.ProspectId,
        request.BusinessName,
        request.ContactName,
        request.ContactEmail,
        request.CreatedOn,
        request.OwnerName,
        request.SourceUrl);
    var extraction = new LiveProspectExtraction(
        request.BusinessName ?? request.ProspectId,
        request.SourceUrl ?? "customer-prospect-use",
        DateTime.UtcNow,
        [row]);

    await SaveProspectExtractionAsync(db, extraction);

    if (request.Detail is not null)
    {
        await SaveProspectDetailAsync(db, request.Detail.ToLiveProspectDetail(request.ProspectId, request.SourceUrl));
    }

    var prospectDbId = await LoadProspectDbIdByReferenceAsync(db, request.ProspectId);
    if (prospectDbId is null)
    {
        return Results.BadRequest(new { error = "Prospect could not be prepared for linking." });
    }

    await using var command = db.CreateCommand("""
        insert into paymentsense_core.match_candidates (
          prospect_id,
          customer_id,
          score,
          match_status,
          reasons
        )
        values (
          @prospect_id,
          @customer_id,
          @score,
          @match_status,
          @reasons::jsonb
        )
        on conflict (prospect_id, customer_id) do update set
          score = excluded.score,
          match_status = excluded.match_status,
          reasons = excluded.reasons,
          generated_at = now()
        """);
    command.Parameters.AddWithValue("prospect_id", prospectDbId.Value);
    command.Parameters.AddWithValue("customer_id", customerId);
    command.Parameters.AddWithValue("score", 0.9900m);
    command.Parameters.AddWithValue("match_status", "candidate");
    command.Parameters.AddWithValue("reasons", JsonSerializer.Serialize(new[] { "selected from prospect import" }));
    await command.ExecuteNonQueryAsync();

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "customer.match.added",
        "customer",
        customerId,
        actor.UserId,
        actor.Name,
        "Prospect linked to customer",
        $"Linked prospect {request.ProspectId} to {FormatCustomerLabel(customer)}.",
        false));

    return Results.Ok(new { linked = true });
});

app.MapDelete("/api/customers/{customerId:long}/matches/{matchId:long}", async (NpgsqlDataSource db, HttpRequest httpRequest, long customerId, long matchId) =>
{
    var match = await LoadMatchActivitySummaryAsync(db, customerId, matchId);
    var removed = await RemoveCustomerMatchAsync(db, customerId, matchId);
    if (removed && match is not null)
    {
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "customer.match.removed",
            "customer",
            customerId,
            actor.UserId,
            actor.Name,
            "Customer match removed",
            $"Removed prospect {match.ProspectId} from {BuildCustomerLabel(match.CustomerRef, match.Mid, match.CustomerName)}.",
            false));
    }

    return removed
        ? Results.Ok(new { removed = true })
        : Results.NotFound(new { error = "Match not found." });
});

app.MapPost("/api/customers/{customerId:long}/archive", async (NpgsqlDataSource db, HttpRequest httpRequest, long customerId) =>
{
    var customer = await LoadCustomerActivitySummaryAsync(db, customerId);
    var result = await ArchiveCustomerAsync(db, customerId);
    if (result.Status == ArchiveStatus.Success && customer is not null)
    {
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "customer.archived",
            "customer",
            customerId,
            actor.UserId,
            actor.Name,
            "Customer archived",
            $"{FormatCustomerLabel(customer)} was archived.",
            true));
    }

    return result.Status switch
    {
        ArchiveStatus.Success => Results.Ok(new { archived = true }),
        ArchiveStatus.NotFound => Results.NotFound(new { error = result.ErrorMessage ?? "Customer not found." }),
        ArchiveStatus.Blocked => Results.Conflict(new { error = result.ErrorMessage ?? "Customer cannot be archived." }),
        _ => Results.BadRequest(new { error = result.ErrorMessage ?? "Customer archive failed." })
    };
});

app.MapPost("/api/prospects/{prospectId:long}/archive", async (NpgsqlDataSource db, HttpRequest httpRequest, long prospectId) =>
{
    var prospect = await LoadProspectActivitySummaryAsync(db, prospectId);
    var result = await ArchiveProspectAsync(db, prospectId);
    if (result.Status == ArchiveStatus.Success && prospect is not null)
    {
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "prospect.archived",
            "prospect",
            prospectId,
            actor.UserId,
            actor.Name,
            "Prospect archived",
            $"{FormatProspectLabel(prospect)} was archived.",
            true));
    }

    return result.Status switch
    {
        ArchiveStatus.Success => Results.Ok(new { archived = true }),
        ArchiveStatus.NotFound => Results.NotFound(new { error = result.ErrorMessage ?? "Prospect not found." }),
        ArchiveStatus.Blocked => Results.Conflict(new { error = result.ErrorMessage ?? "Prospect cannot be archived." }),
        _ => Results.BadRequest(new { error = result.ErrorMessage ?? "Prospect archive failed." })
    };
});

app.MapGet("/api/leads", async (NpgsqlDataSource db) =>
{
    var rows = await LoadLeadsAsync(db, null, null);
    return Results.Ok(rows);
});

app.MapGet("/api/gdpr", async (NpgsqlDataSource db) =>
{
    const string sql = """
        select id, email_address, name, address, created_at
        from paymentsense_core.gdpr
        order by created_at desc, id desc
        """;

    await using var command = db.CreateCommand(sql);
    var rows = new List<GdprEntryResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new GdprEntryResponse(
            reader.GetInt64(0),
            reader.GetNullableString(1),
            reader.GetNullableString(2),
            reader.GetNullableString(3),
            reader.GetDateTime(4)));
    }

    return Results.Ok(rows);
});

app.MapGet("/api/campaigns", async (NpgsqlDataSource db) =>
{
    var campaigns = await LoadCampaignsAsync(db);
    return Results.Ok(campaigns);
});

app.MapPost("/api/campaigns", async (NpgsqlDataSource db, HttpRequest httpRequest, CampaignCreateRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return Results.BadRequest(new { error = "Campaign name is required." });
    }

    const string sql = """
        insert into paymentsense_core.campaigns (
          name,
          description,
          objective,
          start_date,
          end_date,
          target_audience,
          budget,
          product_service,
          status,
          updated_at
        )
        values (
          @name,
          @description,
          @objective,
          @start_date,
          @end_date,
          @target_audience,
          @budget,
          @product_service,
          @status,
          now()
        )
        returning id
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("name", request.Name.Trim());
    command.Parameters.AddWithValue("description", (object?)NullIfBlank(request.Description) ?? DBNull.Value);
    command.Parameters.AddWithValue("objective", (object?)NullIfBlank(request.Objective) ?? DBNull.Value);
    command.Parameters.AddWithValue("start_date", (object?)ParseDateOrNull(request.StartDate) ?? DBNull.Value);
    command.Parameters.AddWithValue("end_date", (object?)ParseDateOrNull(request.EndDate) ?? DBNull.Value);
    command.Parameters.AddWithValue("target_audience", (object?)NullIfBlank(request.TargetAudience) ?? DBNull.Value);
    command.Parameters.AddWithValue("budget", ParseDecimalOrDbNull(request.Budget));
    command.Parameters.AddWithValue("product_service", (object?)NullIfBlank(request.ProductService) ?? DBNull.Value);
    command.Parameters.AddWithValue("status", string.IsNullOrWhiteSpace(request.Status) ? "Draft" : request.Status.Trim());

    var campaignId = (long)(await command.ExecuteScalarAsync() ?? 0L);
    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "campaign.created",
        "campaign",
        campaignId,
        actor.UserId,
        actor.Name,
        "Campaign created",
        $"Campaign {request.Name.Trim()} was created.",
        false));
    var campaigns = await LoadCampaignsAsync(db);
    var created = campaigns.FirstOrDefault(campaign => campaign.Id == campaignId);
    return created is null ? Results.NotFound() : Results.Ok(created);
});

app.MapPost("/api/campaigns/{campaignId:long}/waves", async (NpgsqlDataSource db, HttpRequest httpRequest, long campaignId, CampaignWaveCreateRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return Results.BadRequest(new { error = "Wave name is required." });
    }

    if (request.WaveNumber <= 0)
    {
        return Results.BadRequest(new { error = "Wave number must be greater than zero." });
    }

    const string sql = """
        insert into paymentsense_core.campaign_waves (
          campaign_id,
          name,
          wave_number,
          channel,
          scheduled_date,
          status,
          assigned_team_or_user,
          updated_at
        )
        values (
          @campaign_id,
          @name,
          @wave_number,
          @channel,
          @scheduled_date,
          @status,
          @assigned_team_or_user,
          now()
        )
        returning id
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("campaign_id", campaignId);
    command.Parameters.AddWithValue("name", request.Name.Trim());
    command.Parameters.AddWithValue("wave_number", request.WaveNumber);
    command.Parameters.AddWithValue("channel", string.IsNullOrWhiteSpace(request.Channel) ? "Mixed" : request.Channel.Trim());
    command.Parameters.AddWithValue("scheduled_date", (object?)ParseDateOrNull(request.ScheduledDate) ?? DBNull.Value);
    command.Parameters.AddWithValue("status", string.IsNullOrWhiteSpace(request.Status) ? "Planned" : request.Status.Trim());
    command.Parameters.AddWithValue("assigned_team_or_user", (object?)NullIfBlank(request.AssignedTeamOrUser) ?? DBNull.Value);

    try
    {
        await command.ExecuteScalarAsync();
    }
    catch (PostgresException ex) when (ex.SqlState == "23503")
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    var wave = await LoadCampaignWaveActivitySummaryAsync(db, campaignId, request.Name.Trim(), request.WaveNumber);
    if (wave is not null)
    {
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "campaign.wave.created",
            "campaign_wave",
            wave.Id,
            actor.UserId,
            actor.Name,
            "Campaign wave created",
            $"{wave.CampaignName} wave {wave.WaveNumber}: {wave.Name}.",
            false));
    }

    var campaigns = await LoadCampaignsAsync(db);
    var updated = campaigns.FirstOrDefault(campaign => campaign.Id == campaignId);
    return updated is null ? Results.NotFound(new { error = "Campaign not found." }) : Results.Ok(updated);
});

app.MapPost("/api/campaign-waves/{waveId:long}/leads", async (NpgsqlDataSource db, long waveId, CampaignWaveLeadAssignRequest request) =>
{
    if (request.LeadIds is null || request.LeadIds.Count == 0)
    {
        return Results.BadRequest(new { error = "Select at least one lead." });
    }

    const string waveExistsSql = """
        select exists(
          select 1
          from paymentsense_core.campaign_waves
          where id = @wave_id
        )
        """;

    await using (var existsCommand = db.CreateCommand(waveExistsSql))
    {
        existsCommand.Parameters.AddWithValue("wave_id", waveId);
        var exists = (bool)(await existsCommand.ExecuteScalarAsync() ?? false);
        if (!exists)
        {
            return Results.NotFound(new { error = "Wave not found." });
        }
    }

    const string insertSql = """
        insert into paymentsense_core.campaign_wave_leads (campaign_wave_id, lead_id)
        select @wave_id, unnest(@lead_ids)
        on conflict (campaign_wave_id, lead_id) do nothing
        """;

    await using var command = db.CreateCommand(insertSql);
    command.Parameters.AddWithValue("wave_id", waveId);
    command.Parameters.AddWithValue("lead_ids", request.LeadIds.Distinct().ToArray());
    var inserted = await command.ExecuteNonQueryAsync();

    return Results.Ok(new { assigned = inserted });
});

app.MapGet("/api/campaign-waves/{waveId:long}/leads", async (NpgsqlDataSource db, long waveId) =>
{
    var withProspects = await LoadCampaignWaveLeadsAsync(db, waveId);
    var gdprLeadIds = await LoadGdprMatchedLeadIdsAsync(db, withProspects);

    return Results.Ok(withProspects
        .Select(row => gdprLeadIds.Contains(row.Id) ? row with { LeadStatus = "GDPR" } : row)
        .ToList());
});

app.MapDelete("/api/campaign-waves/{waveId:long}/leads/{leadId:long}", async (NpgsqlDataSource db, HttpRequest httpRequest, long waveId, long leadId) =>
{
    CampaignWaveActivitySummary? wave;
    await using (var waveCommand = db.CreateCommand("""
        select cw.id, c.name, cw.name, cw.wave_number
        from paymentsense_core.campaign_waves cw
        join paymentsense_core.campaigns c on c.id = cw.campaign_id
        where cw.id = @wave_id
        """))
    {
        waveCommand.Parameters.AddWithValue("wave_id", waveId);
        await using var reader = await waveCommand.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return Results.NotFound(new { error = "Wave not found." });
        }

        wave = new CampaignWaveActivitySummary(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetInt32(3));
    }

    var lead = await LoadLeadActivitySummaryAsync(db, leadId);

    await using var command = db.CreateCommand("""
        delete from paymentsense_core.campaign_wave_leads
        where campaign_wave_id = @wave_id
          and lead_id = @lead_id
        """);
    command.Parameters.AddWithValue("wave_id", waveId);
    command.Parameters.AddWithValue("lead_id", leadId);
    var removed = await command.ExecuteNonQueryAsync();

    if (removed > 0 && wave is not null && lead is not null)
    {
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "campaign.wave.lead.removed",
            "campaign_wave",
            waveId,
            actor.UserId,
            actor.Name,
            "Lead removed from wave",
            $"{FormatLeadLabel(lead)} was removed from {wave.CampaignName} wave {wave.WaveNumber}: {wave.Name}.",
            true));
    }

    return removed > 0
        ? Results.Ok(new { removed = true })
        : Results.NotFound(new { error = "Lead was not in that wave." });
});

app.MapGet("/api/campaign-waves/{waveId:long}/export", async (NpgsqlDataSource db, long waveId) =>
{
    var rows = await LoadCampaignWaveLeadsAsync(db, waveId);
    var gdprLeadIds = await LoadGdprMatchedLeadIdsAsync(db, rows);
    var csv = BuildLeadsCsv(rows
        .Select(row => gdprLeadIds.Contains(row.Id) ? row with { LeadStatus = "GDPR" } : row)
        .ToList());

    return Results.File(
        System.Text.Encoding.UTF8.GetBytes(csv),
        "text/csv; charset=utf-8",
        $"campaign-wave-{waveId}-leads.csv");
});

app.MapPost("/api/gdpr", async (NpgsqlDataSource db, GdprCreateRequest request) =>
{
    var email = string.IsNullOrWhiteSpace(request.EmailAddress) ? null : request.EmailAddress.Trim();
    var name = string.IsNullOrWhiteSpace(request.Name) ? null : request.Name.Trim();
    var address = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim();

    if (email is null && name is null && address is null)
    {
        return Results.BadRequest(new { error = "Enter at least one GDPR value." });
    }

    const string sql = """
        insert into paymentsense_core.gdpr (
          email_address,
          normalized_email,
          name,
          normalized_name,
          address,
          normalized_address,
          updated_at
        )
        values (
          @email_address,
          @normalized_email,
          @name,
          @normalized_name,
          @address,
          @normalized_address,
          now()
        )
        returning id, email_address, name, address, created_at
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("email_address", (object?)email ?? DBNull.Value);
    command.Parameters.AddWithValue("normalized_email", (object?)TextNormalizer.NormalizeEmail(email) ?? DBNull.Value);
    command.Parameters.AddWithValue("name", (object?)name ?? DBNull.Value);
    command.Parameters.AddWithValue("normalized_name", (object?)(name is null ? null : TextNormalizer.NormalizeOrganisationName(name)) ?? DBNull.Value);
    command.Parameters.AddWithValue("address", (object?)address ?? DBNull.Value);
    command.Parameters.AddWithValue("normalized_address", (object?)TextNormalizer.NormalizeLooseText(address) ?? DBNull.Value);

    await using var reader = await command.ExecuteReaderAsync();
    await reader.ReadAsync();
    return Results.Ok(new GdprEntryResponse(
        reader.GetInt64(0),
        reader.GetNullableString(1),
        reader.GetNullableString(2),
        reader.GetNullableString(3),
        reader.GetDateTime(4)));
});

app.MapGet("/api/leads/export", async (NpgsqlDataSource db, string? searchText, string? status, long? assignedUserId) =>
{
    var rows = await LoadLeadsAsync(db, searchText, status, assignedUserId);
    var csv = BuildLeadsCsv(rows);
    return Results.File(
        System.Text.Encoding.UTF8.GetBytes(csv),
        "text/csv; charset=utf-8",
        "leads.csv");
});

app.MapGet("/api/leads/{leadId:long}", async (NpgsqlDataSource db, long leadId) =>
{
    var detail = await LoadLeadDetailAsync(db, leadId);
    return detail is null
        ? Results.NotFound(new { error = "Lead not found." })
        : Results.Ok(detail);
});

app.MapGet("/api/leads/{leadId:long}/notes", async (NpgsqlDataSource db, long leadId) =>
{
    var leadExists = await LeadExistsAsync(db, leadId);
    if (!leadExists)
    {
        return Results.NotFound(new { error = "Lead not found." });
    }

    return Results.Ok(await LoadLeadNotesAsync(db, leadId));
});

app.MapGet("/api/lead-notes/{leadId:long}", async (NpgsqlDataSource db, long leadId) =>
{
    var leadExists = await LeadExistsAsync(db, leadId);
    if (!leadExists)
    {
        return Results.NotFound(new { error = "Lead not found." });
    }

    return Results.Ok(await LoadLeadNotesAsync(db, leadId));
});

app.MapPatch("/api/leads/{leadId:long}/status", async (NpgsqlDataSource db, HttpRequest httpRequest, long leadId, LeadStatusUpdateRequest request) =>
{
    if (!await LeadStatusExistsAsync(db, request.LeadStatus))
    {
        return Results.BadRequest(new { error = "Lead status not found." });
    }

    var before = await LoadLeadActivitySummaryAsync(db, leadId);
    var updated = await UpdateLeadStatusAsync(db, leadId, request.LeadStatus.Trim());
    if (before is not null && updated is not null && !string.Equals(before.LeadStatus, updated.LeadStatus, StringComparison.OrdinalIgnoreCase))
    {
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "lead.status.updated",
            "lead",
            leadId,
            actor.UserId,
            actor.Name,
            "Lead status updated",
            $"{FormatLeadLabel(before)} changed from {before.LeadStatus} to {updated.LeadStatus}.",
            true));
    }

    return updated is null
        ? Results.NotFound(new { error = "Lead not found." })
        : Results.Ok(updated);
});

app.MapPatch("/api/leads/{leadId:long}/assigned-user", async (NpgsqlDataSource db, HttpRequest httpRequest, long leadId, LeadAssignedUserUpdateRequest request) =>
{
    var before = await LoadLeadActivitySummaryAsync(db, leadId);
    var updated = await UpdateLeadAssignedUserAsync(db, leadId, request.AssignedUserId);
    if (before is not null && updated is not null && before.AssignedUserId != updated.AssignedUserId)
    {
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        var title = updated.AssignedUserId.HasValue ? "Lead assigned" : "Lead unassigned";
        var description = updated.AssignedUserId.HasValue
            ? $"{FormatLeadLabel(before)} assigned to {updated.AssignedUserName ?? "Unknown user"}."
            : $"{FormatLeadLabel(before)} was unassigned.";
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "lead.assignment.updated",
            "lead",
            leadId,
            actor.UserId,
            actor.Name,
            title,
            description,
            true));
    }

    return updated is null
        ? Results.NotFound(new { error = "Lead not found." })
        : Results.Ok(updated);
});

app.MapPatch("/api/leads/{leadId:long}/priority", async (NpgsqlDataSource db, HttpRequest httpRequest, long leadId, LeadPriorityUpdateRequest request) =>
{
    if (!IsValidLeadPriority(request.LeadPriority))
    {
        return Results.BadRequest(new { error = "Lead priority not found." });
    }

    var before = await LoadLeadActivitySummaryAsync(db, leadId);
    var updated = await UpdateLeadPriorityAsync(db, leadId, request.LeadPriority.Trim().ToLowerInvariant());
    if (before is not null && updated is not null && !string.Equals(before.LeadPriority, updated.LeadPriority, StringComparison.OrdinalIgnoreCase))
    {
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "lead.priority.updated",
            "lead",
            leadId,
            actor.UserId,
            actor.Name,
            "Lead priority updated",
            $"{FormatLeadLabel(before)} priority changed from {FormatLeadPriorityLabel(before.LeadPriority)} to {FormatLeadPriorityLabel(updated.LeadPriority)}.",
            true));
    }

    return updated is null
        ? Results.NotFound(new { error = "Lead not found." })
        : Results.Ok(updated);
});

app.MapPatch("/api/leads/{leadId:long}/primary-prospect", async (NpgsqlDataSource db, HttpRequest httpRequest, long leadId, LeadPrimaryProspectUpdateRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.ProspectId))
    {
        return Results.BadRequest(new { error = "ProspectId is required." });
    }

    var before = await LoadLeadActivitySummaryAsync(db, leadId);
    var updated = await UpdateLeadPrimaryProspectAsync(db, leadId, request.ProspectId.Trim());
    if (updated is null)
    {
        return Results.NotFound(new { error = "Lead or linked prospect not found." });
    }

    if (before is not null)
    {
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "lead.primary_prospect.updated",
            "lead",
            leadId,
            actor.UserId,
            actor.Name,
            "Lead primary prospect updated",
            $"{FormatLeadLabel(before)} primary prospect set to {request.ProspectId.Trim()}.",
            true));
    }

    return Results.Ok(updated);
});

app.MapPost("/api/leads/{leadId:long}/contact-history", async (NpgsqlDataSource db, HttpRequest httpRequest, long leadId, LeadContactHistoryCreateRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.Channel))
    {
        return Results.BadRequest(new { error = "Channel is required." });
    }

    var contactedAt = DateTime.TryParse(request.ContactedAt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var parsedContactedAt)
        ? parsedContactedAt
        : DateTime.UtcNow;

    await using var command = db.CreateCommand("""
        insert into paymentsense_core.lead_contact_history (
          lead_id,
          channel,
          contacted_at,
          outcome,
          notes,
          reason,
          who_by,
          response_status
        )
        values (
          @lead_id,
          @channel,
          @contacted_at,
          null,
          @notes,
          @reason,
          @who_by,
          @response_status
        )
        """);
    command.Parameters.AddWithValue("lead_id", leadId);
    command.Parameters.AddWithValue("channel", request.Channel.Trim());
    command.Parameters.AddWithValue("contacted_at", contactedAt);
    command.Parameters.AddWithValue("notes", (object?)NullIfBlank(request.Notes) ?? DBNull.Value);
    command.Parameters.AddWithValue("reason", (object?)NullIfBlank(request.Reason) ?? DBNull.Value);
    command.Parameters.AddWithValue("who_by", (object?)NullIfBlank(request.WhoBy) ?? DBNull.Value);
    command.Parameters.AddWithValue("response_status", (object?)NullIfBlank(request.ResponseStatus) ?? DBNull.Value);

    try
    {
        await command.ExecuteNonQueryAsync();
    }
    catch (PostgresException ex) when (ex.SqlState == "23503")
    {
        return Results.NotFound(new { error = "Lead not found." });
    }

    var detail = await LoadLeadDetailAsync(db, leadId);
    if (detail is not null)
    {
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        var isNote = string.Equals(request.Channel.Trim(), "other", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(request.Notes);
        var title = isNote ? "Lead note added" : "Lead contact event added";
        var description = isNote
            ? $"Added a note to Lead #{detail.Id} for {detail.CustomerName}."
            : $"Added a {request.Channel.Trim()} contact event to Lead #{detail.Id} for {detail.CustomerName}.";
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            isNote ? "lead.note.added" : "lead.contact_history.added",
            "lead",
            leadId,
            actor.UserId,
            actor.Name,
            title,
            description,
            false));
    }

    return detail is null
        ? Results.NotFound(new { error = "Lead not found." })
        : Results.Ok(detail);
});

app.MapPost("/api/leads/{leadId:long}/notes", async (NpgsqlDataSource db, HttpRequest httpRequest, long leadId, LeadNoteCreateRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.NoteText))
    {
        return Results.BadRequest(new { error = "Note text is required." });
    }

    if (request.UserId.HasValue)
    {
        await using var userExistsCommand = db.CreateCommand("""
            select exists(
              select 1
              from paymentsense_core.users
              where id = @user_id
            )
            """);
        userExistsCommand.Parameters.AddWithValue("user_id", request.UserId.Value);
        var userExists = (bool?) await userExistsCommand.ExecuteScalarAsync() ?? false;
        if (!userExists)
        {
            return Results.BadRequest(new { error = "Selected user was not found." });
        }
    }

    var notedAt = DateTime.TryParse(request.NotedAt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var parsedNotedAt)
        ? parsedNotedAt
        : DateTime.UtcNow;

    await using var command = db.CreateCommand("""
        insert into paymentsense_core.lead_notes (
          lead_id,
          user_id,
          note_text,
          noted_at
        )
        values (
          @lead_id,
          @user_id,
          @note_text,
          @noted_at
        )
        """);
    command.Parameters.AddWithValue("lead_id", leadId);
    command.Parameters.AddWithValue("user_id", (object?) request.UserId ?? DBNull.Value);
    command.Parameters.AddWithValue("note_text", request.NoteText.Trim());
    command.Parameters.AddWithValue("noted_at", notedAt);

    try
    {
        await command.ExecuteNonQueryAsync();
    }
    catch (PostgresException ex) when (ex.SqlState == "23503")
    {
        return Results.NotFound(new { error = "Lead not found." });
    }

    var detail = await LoadLeadDetailAsync(db, leadId);
    if (detail is not null)
    {
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "lead.note.added",
            "lead",
            leadId,
            actor.UserId,
            actor.Name,
            "Lead note added",
            $"Added a note to Lead #{detail.Id} for {detail.CustomerName}.",
            false));
    }

    return detail is null
        ? Results.NotFound(new { error = "Lead not found." })
        : Results.Ok(detail);
});

app.MapDelete("/api/leads/{leadId:long}", async (NpgsqlDataSource db, HttpRequest httpRequest, long leadId) =>
{
    var lead = await LoadLeadActivitySummaryAsync(db, leadId);
    var removed = await RemoveLeadAsync(db, leadId);
    if (removed && lead is not null)
    {
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "lead.removed",
            "lead",
            leadId,
            actor.UserId,
            actor.Name,
            "Lead removed",
            $"{FormatLeadLabel(lead)} was removed.",
            true));
    }

    return removed
        ? Results.Ok(new { removed = true })
        : Results.NotFound(new { error = "Lead not found." });
});

app.MapGet("/api/users", async (NpgsqlDataSource db) =>
{
    const string sql = """
        select id, full_name, initials, phone, email, color, created_at
        from paymentsense_core.users
        order by full_name asc, id asc
        """;

    await using var command = db.CreateCommand(sql);
    var rows = new List<UserResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new UserResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetNullableString(3),
            reader.GetNullableString(4),
            reader.GetNullableString(5),
            reader.GetDateTime(6)));
    }

    return Results.Ok(rows);
});

app.MapGet("/api/regions", async (NpgsqlDataSource db) =>
{
    const string sql = """
        select id, name, created_at, updated_at
        from paymentsense_core.regions
        order by name asc, id asc
        """;

    await using var command = db.CreateCommand(sql);
    var rows = new List<RegionResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new RegionResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetDateTime(2),
            reader.GetDateTime(3)));
    }

    return Results.Ok(rows);
});

app.MapGet("/api/company-sic-codes", async (NpgsqlDataSource db) =>
{
    return Results.Ok(await LoadCompanySicCodesAsync(db));
});

app.MapGet("/api/business-types", async (NpgsqlDataSource db) =>
{
    return Results.Ok(await LoadBusinessTypesAsync(db));
});

app.MapGet("/api/customer-business-type-options", async (NpgsqlDataSource db) =>
{
    return Results.Ok(await LoadCustomerBusinessTypeOptionsAsync(db));
});

app.MapGet("/api/lead-statuses", async (NpgsqlDataSource db) =>
{
    return Results.Ok(await LoadLeadStatusesAsync(db));
});

app.MapGet("/api/customer-activity-statuses", async (NpgsqlDataSource db) =>
{
    return Results.Ok(await LoadCustomerActivityStatusesAsync(db));
});

app.MapGet("/api/customer-value-types", async (NpgsqlDataSource db) =>
{
    return Results.Ok(await LoadCustomerValueTypesAsync(db));
});

app.MapPost("/api/regions", async (NpgsqlDataSource db, HttpRequest httpRequest, RegionCreateRequest request) =>
{
    var name = request.Name.Trim();
    if (string.IsNullOrWhiteSpace(name))
    {
        return Results.BadRequest(new { error = "Region name is required." });
    }

    var normalizedName = TextNormalizer.NormalizeOrganisationName(name);
    if (string.IsNullOrWhiteSpace(normalizedName))
    {
        return Results.BadRequest(new { error = "Region name is invalid." });
    }

    await using var command = db.CreateCommand("""
        insert into paymentsense_core.regions (
          name,
          normalized_name
        )
        values (
          @name,
          @normalized_name
        )
        returning id
        """);
    command.Parameters.AddWithValue("name", name);
    command.Parameters.AddWithValue("normalized_name", normalizedName);

    try
    {
        var regionId = (long)(await command.ExecuteScalarAsync() ?? 0L);
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "region.created",
            "region",
            regionId,
            actor.UserId,
            actor.Name,
            "Region added",
            $"{name} was added as a region.",
            false));
        return Results.Ok(new { id = regionId, added = true });
    }
    catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
    {
        return Results.Conflict(new { error = "A region with that name already exists." });
    }
});

app.MapPatch("/api/regions/{regionId:long}", async (NpgsqlDataSource db, HttpRequest httpRequest, long regionId, RegionUpdateRequest request) =>
{
    var name = request.Name.Trim();
    if (string.IsNullOrWhiteSpace(name))
    {
        return Results.BadRequest(new { error = "Region name is required." });
    }

    var normalizedName = TextNormalizer.NormalizeOrganisationName(name);
    if (string.IsNullOrWhiteSpace(normalizedName))
    {
        return Results.BadRequest(new { error = "Region name is invalid." });
    }

    string? previousName;
    await using (var lookup = db.CreateCommand("""
        select name
        from paymentsense_core.regions
        where id = @region_id
        """))
    {
        lookup.Parameters.AddWithValue("region_id", regionId);
        previousName = await lookup.ExecuteScalarAsync() as string;
    }

    if (previousName is null)
    {
        return Results.NotFound(new { error = "Region not found." });
    }

    await using var command = db.CreateCommand("""
        update paymentsense_core.regions
        set
          name = @name,
          normalized_name = @normalized_name,
          updated_at = now()
        where id = @region_id
        """);
    command.Parameters.AddWithValue("region_id", regionId);
    command.Parameters.AddWithValue("name", name);
    command.Parameters.AddWithValue("normalized_name", normalizedName);

    try
    {
        await command.ExecuteNonQueryAsync();
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "region.updated",
            "region",
            regionId,
            actor.UserId,
            actor.Name,
            "Region updated",
            previousName == name
                ? $"{name} was updated."
                : $"{previousName} was renamed to {name}.",
            false));
        return Results.Ok(new { id = regionId, updated = true });
    }
    catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
    {
        return Results.Conflict(new { error = "A region with that name already exists." });
    }
});

app.MapPost("/api/business-types", async (NpgsqlDataSource db, HttpRequest httpRequest, BusinessTypeCreateRequest request) =>
{
    var name = request.Name.Trim();
    if (string.IsNullOrWhiteSpace(name))
    {
        return Results.BadRequest(new { error = "Business type name is required." });
    }

    var normalizedName = TextNormalizer.NormalizeLooseText(name);
    if (string.IsNullOrWhiteSpace(normalizedName))
    {
        return Results.BadRequest(new { error = "Business type name is invalid." });
    }

    var sicCode = NullIfBlank(request.SicCode);
    if (sicCode is not null && !await CompanySicCodeExistsAsync(db, sicCode))
    {
        return Results.BadRequest(new { error = "The selected SIC code could not be found." });
    }

    await using var command = db.CreateCommand("""
        insert into paymentsense_core.business_types (
          name,
          normalized_name,
          sic_code
        )
        values (
          @name,
          @normalized_name,
          @sic_code
        )
        returning id
        """);
    command.Parameters.AddWithValue("name", name);
    command.Parameters.AddWithValue("normalized_name", normalizedName);
    command.Parameters.AddWithValue("sic_code", (object?)sicCode ?? DBNull.Value);

    try
    {
        var id = (long)(await command.ExecuteScalarAsync() ?? 0L);
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "business_type.created",
            "business_type",
            id,
            actor.UserId,
            actor.Name,
            "Business type added",
            sicCode is null
                ? $"{name} was added as a business type."
                : $"{name} was added as a business type with SIC {sicCode}.",
            false));
        return Results.Ok(new { id, added = true });
    }
    catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
    {
        return Results.Conflict(new { error = "That business type already exists." });
    }
});

app.MapPatch("/api/business-types/{businessTypeId:long}", async (NpgsqlDataSource db, HttpRequest httpRequest, long businessTypeId, BusinessTypeUpdateRequest request) =>
{
    var name = request.Name.Trim();
    if (string.IsNullOrWhiteSpace(name))
    {
        return Results.BadRequest(new { error = "Business type name is required." });
    }

    var normalizedName = TextNormalizer.NormalizeLooseText(name);
    if (string.IsNullOrWhiteSpace(normalizedName))
    {
        return Results.BadRequest(new { error = "Business type name is invalid." });
    }

    var sicCode = NullIfBlank(request.SicCode);
    if (sicCode is not null && !await CompanySicCodeExistsAsync(db, sicCode))
    {
        return Results.BadRequest(new { error = "The selected SIC code could not be found." });
    }

    BusinessTypeResponse? current;
    await using (var lookup = db.CreateCommand("""
        select bt.id, bt.name, bt.sic_code, sic.description, bt.created_at, bt.updated_at
        from paymentsense_core.business_types bt
        left join paymentsense_core.company_sic_codes sic on sic.code = bt.sic_code
        where bt.id = @business_type_id
        """))
    {
        lookup.Parameters.AddWithValue("business_type_id", businessTypeId);
        await using var reader = await lookup.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return Results.NotFound(new { error = "Business type not found." });
        }

        current = new BusinessTypeResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetNullableString(2),
            reader.GetNullableString(3),
            reader.GetDateTime(4),
            reader.GetDateTime(5));
    }

    await using var command = db.CreateCommand("""
        update paymentsense_core.business_types
        set
          name = @name,
          normalized_name = @normalized_name,
          sic_code = @sic_code,
          updated_at = now()
        where id = @business_type_id
        """);
    command.Parameters.AddWithValue("business_type_id", businessTypeId);
    command.Parameters.AddWithValue("name", name);
    command.Parameters.AddWithValue("normalized_name", normalizedName);
    command.Parameters.AddWithValue("sic_code", (object?)sicCode ?? DBNull.Value);

    try
    {
        await command.ExecuteNonQueryAsync();
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "business_type.updated",
            "business_type",
            businessTypeId,
            actor.UserId,
            actor.Name,
            "Business type updated",
            current.Name == name
                ? $"{name} was updated."
                : $"{current.Name} was renamed to {name}.",
            false));
        return Results.Ok(new { id = businessTypeId, updated = true });
    }
    catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
    {
        return Results.Conflict(new { error = "That business type already exists." });
    }
});

app.MapPatch("/api/customer-value-types/{customerValueTypeId:long}", async (NpgsqlDataSource db, HttpRequest httpRequest, long customerValueTypeId, CustomerValueTypeUpdateRequest request) =>
{
    CustomerValueTypeResponse? current;
    await using (var lookup = db.CreateCommand("""
        select id, shield_order, shield_key, image_file_name, label, decimal_value, created_at, updated_at
        from paymentsense_core.customer_value_types
        where id = @customer_value_type_id
        """))
    {
        lookup.Parameters.AddWithValue("customer_value_type_id", customerValueTypeId);
        await using var reader = await lookup.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return Results.NotFound(new { error = "Customer value type not found." });
        }

        current = new CustomerValueTypeResponse(
            reader.GetInt64(0),
            reader.GetInt32(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetNullableString(4),
            reader.IsDBNull(5) ? null : reader.GetDecimal(5),
            reader.GetDateTime(6),
            reader.GetDateTime(7));
    }

    if (request.DecimalValue is < 0)
    {
        return Results.BadRequest(new { error = "Decimal value cannot be negative." });
    }

    var label = NullIfBlank(request.Label);
    await using var command = db.CreateCommand("""
        update paymentsense_core.customer_value_types
        set
          label = @label,
          decimal_value = @decimal_value,
          updated_at = now()
        where id = @customer_value_type_id
        """);
    command.Parameters.AddWithValue("customer_value_type_id", customerValueTypeId);
    command.Parameters.AddWithValue("label", (object?)label ?? DBNull.Value);
    command.Parameters.AddWithValue("decimal_value", (object?)request.DecimalValue ?? DBNull.Value);
    await command.ExecuteNonQueryAsync();

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "customer_value_type.updated",
        "customer_value_type",
        customerValueTypeId,
        actor.UserId,
        actor.Name,
        "Customer value type updated",
        $"Customer value type shield {current.ShieldOrder} was updated.",
        false));

    return Results.Ok(new { id = customerValueTypeId, updated = true });
});

app.MapPost("/api/customer-activity-statuses", async (NpgsqlDataSource db, HttpRequest httpRequest, CustomerActivityStatusCreateRequest request) =>
{
    var name = request.Name.Trim();
    if (string.IsNullOrWhiteSpace(name))
    {
        return Results.BadRequest(new { error = "Customer activity status name is required." });
    }

    var normalizedName = TextNormalizer.NormalizeLooseText(name);
    if (string.IsNullOrWhiteSpace(normalizedName))
    {
        return Results.BadRequest(new { error = "Customer activity status name is invalid." });
    }

    var sortOrder = request.SortOrder ?? await GetNextCustomerActivityStatusSortOrderAsync(db);

    await using var command = db.CreateCommand("""
        insert into paymentsense_core.customer_activity_statuses (
          name,
          normalized_name,
          sort_order
        )
        values (
          @name,
          @normalized_name,
          @sort_order
        )
        returning id
        """);
    command.Parameters.AddWithValue("name", name);
    command.Parameters.AddWithValue("normalized_name", normalizedName);
    command.Parameters.AddWithValue("sort_order", sortOrder);

    try
    {
        var id = (long)(await command.ExecuteScalarAsync() ?? 0L);
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "customer_activity_status.created",
            "customer_activity_status",
            id,
            actor.UserId,
            actor.Name,
            "Customer activity status added",
            $"{name} was added as a customer activity status.",
            false));
        return Results.Ok(new { id, added = true });
    }
    catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
    {
        return Results.Conflict(new { error = "That customer activity status already exists." });
    }
});

app.MapPatch("/api/customer-activity-statuses/{statusId:long}", async (NpgsqlDataSource db, HttpRequest httpRequest, long statusId, CustomerActivityStatusUpdateRequest request) =>
{
    var name = request.Name.Trim();
    if (string.IsNullOrWhiteSpace(name))
    {
        return Results.BadRequest(new { error = "Customer activity status name is required." });
    }

    var normalizedName = TextNormalizer.NormalizeLooseText(name);
    if (string.IsNullOrWhiteSpace(normalizedName))
    {
        return Results.BadRequest(new { error = "Customer activity status name is invalid." });
    }

    CustomerActivityStatusResponse? current;
    await using (var lookup = db.CreateCommand("""
        select id, name, sort_order, created_at, updated_at
        from paymentsense_core.customer_activity_statuses
        where id = @status_id
        """))
    {
        lookup.Parameters.AddWithValue("status_id", statusId);
        await using var reader = await lookup.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return Results.NotFound(new { error = "Customer activity status not found." });
        }

        current = new CustomerActivityStatusResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetInt32(2),
            reader.GetDateTime(3),
            reader.GetDateTime(4));
    }

    var sortOrder = request.SortOrder ?? current.SortOrder;

    await using var command = db.CreateCommand("""
        update paymentsense_core.customer_activity_statuses
        set
          name = @name,
          normalized_name = @normalized_name,
          sort_order = @sort_order,
          updated_at = now()
        where id = @status_id
        """);
    command.Parameters.AddWithValue("status_id", statusId);
    command.Parameters.AddWithValue("name", name);
    command.Parameters.AddWithValue("normalized_name", normalizedName);
    command.Parameters.AddWithValue("sort_order", sortOrder);

    try
    {
        await command.ExecuteNonQueryAsync();
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "customer_activity_status.updated",
            "customer_activity_status",
            statusId,
            actor.UserId,
            actor.Name,
            "Customer activity status updated",
            current.Name == name
                ? $"{name} was updated."
                : $"{current.Name} was renamed to {name}.",
            false));
        return Results.Ok(new { id = statusId, updated = true });
    }
    catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
    {
        return Results.Conflict(new { error = "That customer activity status already exists." });
    }
});

app.MapPost("/api/lead-statuses", async (NpgsqlDataSource db, HttpRequest httpRequest, LeadStatusCreateRequest request) =>
{
    var name = request.Name.Trim();
    if (string.IsNullOrWhiteSpace(name))
    {
        return Results.BadRequest(new { error = "Lead status name is required." });
    }

    var normalizedName = TextNormalizer.NormalizeLooseText(name);
    if (string.IsNullOrWhiteSpace(normalizedName))
    {
        return Results.BadRequest(new { error = "Lead status name is invalid." });
    }

    var sortOrder = request.SortOrder ?? await GetNextLeadStatusSortOrderAsync(db);

    await using var command = db.CreateCommand("""
        insert into paymentsense_core.lead_statuses (
          name,
          normalized_name,
          sort_order
        )
        values (
          @name,
          @normalized_name,
          @sort_order
        )
        returning id
        """);
    command.Parameters.AddWithValue("name", name);
    command.Parameters.AddWithValue("normalized_name", normalizedName);
    command.Parameters.AddWithValue("sort_order", sortOrder);

    try
    {
        var leadStatusId = (long)(await command.ExecuteScalarAsync() ?? 0L);
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "lead_status.created",
            "lead_status",
            leadStatusId,
            actor.UserId,
            actor.Name,
            "Lead status added",
            $"{name} was added as a lead status.",
            false));
        return Results.Ok(new { id = leadStatusId, added = true });
    }
    catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
    {
        return Results.Conflict(new { error = "That lead status already exists." });
    }
});

app.MapPatch("/api/lead-statuses/{leadStatusId:long}", async (NpgsqlDataSource db, HttpRequest httpRequest, long leadStatusId, LeadStatusUpdateEntityRequest request) =>
{
    var name = request.Name.Trim();
    if (string.IsNullOrWhiteSpace(name))
    {
        return Results.BadRequest(new { error = "Lead status name is required." });
    }

    var normalizedName = TextNormalizer.NormalizeLooseText(name);
    if (string.IsNullOrWhiteSpace(normalizedName))
    {
        return Results.BadRequest(new { error = "Lead status name is invalid." });
    }

    LeadStatusResponse? current;
    await using (var lookup = db.CreateCommand("""
        select id, name, sort_order, created_at, updated_at
        from paymentsense_core.lead_statuses
        where id = @lead_status_id
        """))
    {
        lookup.Parameters.AddWithValue("lead_status_id", leadStatusId);
        await using var reader = await lookup.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return Results.NotFound(new { error = "Lead status not found." });
        }

        current = new LeadStatusResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetInt32(2),
            reader.GetDateTime(3),
            reader.GetDateTime(4));
    }

    var sortOrder = request.SortOrder ?? current.SortOrder;

    await using var command = db.CreateCommand("""
        update paymentsense_core.lead_statuses
        set
          name = @name,
          normalized_name = @normalized_name,
          sort_order = @sort_order,
          updated_at = now()
        where id = @lead_status_id
        """);
    command.Parameters.AddWithValue("lead_status_id", leadStatusId);
    command.Parameters.AddWithValue("name", name);
    command.Parameters.AddWithValue("normalized_name", normalizedName);
    command.Parameters.AddWithValue("sort_order", sortOrder);

    try
    {
        await command.ExecuteNonQueryAsync();
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "lead_status.updated",
            "lead_status",
            leadStatusId,
            actor.UserId,
            actor.Name,
            "Lead status updated",
            current.Name == name
                ? $"{name} was updated."
                : $"{current.Name} was renamed to {name}.",
            false));
        return Results.Ok(new { id = leadStatusId, updated = true });
    }
    catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
    {
        return Results.Conflict(new { error = "That lead status already exists." });
    }
});

app.MapPost("/api/users", async (NpgsqlDataSource db, HttpRequest httpRequest, UserCreateRequest request) =>
{
    var fullName = request.FullName.Trim();
    var initials = request.Initials.Trim();
    if (string.IsNullOrWhiteSpace(fullName))
    {
        return Results.BadRequest(new { error = "Name is required." });
    }

    if (string.IsNullOrWhiteSpace(initials))
    {
        return Results.BadRequest(new { error = "Initials are required." });
    }

    var color = NormalizeUserColor(request.Color);
    if (request.Color is not null && color is null)
    {
        return Results.BadRequest(new { error = "Colour must be a valid hex value like #d62828." });
    }

    await using var command = db.CreateCommand("""
        insert into paymentsense_core.users (
          full_name,
          initials,
          phone,
          email,
          color
        )
        values (
          @full_name,
          @initials,
          @phone,
          @email,
          @color
        )
        returning id
        """);
    command.Parameters.AddWithValue("full_name", fullName);
    command.Parameters.AddWithValue("initials", initials);
    command.Parameters.AddWithValue("phone", (object?)NullIfBlank(request.Phone) ?? DBNull.Value);
    command.Parameters.AddWithValue("email", (object?)NullIfBlank(request.Email) ?? DBNull.Value);
    command.Parameters.AddWithValue("color", (object?)color ?? DBNull.Value);

    var userId = (long)(await command.ExecuteScalarAsync() ?? 0L);
    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "user.created",
        "user",
        userId,
        actor.UserId,
        actor.Name,
        "User added",
        $"{fullName} was added as a user.",
        false));
    return Results.Ok(new { id = userId, added = true });
});

app.MapPatch("/api/users/{userId:long}/color", async (NpgsqlDataSource db, HttpRequest httpRequest, long userId, UserColorUpdateRequest request) =>
{
    var color = NormalizeUserColor(request.Color);
    if (request.Color is not null && color is null)
    {
        return Results.BadRequest(new { error = "Colour must be a valid hex value like #d62828." });
    }

    string? fullName;
    await using (var lookup = db.CreateCommand("""
        select full_name
        from paymentsense_core.users
        where id = @user_id
        """))
    {
        lookup.Parameters.AddWithValue("user_id", userId);
        fullName = await lookup.ExecuteScalarAsync() as string;
    }

    if (fullName is null)
    {
        return Results.NotFound(new { error = "User not found." });
    }

    await using var command = db.CreateCommand("""
        update paymentsense_core.users
        set
          color = @color,
          updated_at = now()
        where id = @user_id
        """);
    command.Parameters.AddWithValue("user_id", userId);
    command.Parameters.AddWithValue("color", (object?)color ?? DBNull.Value);
    await command.ExecuteNonQueryAsync();

    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "user.color.updated",
        "user",
        userId,
        actor.UserId,
        actor.Name,
        "User colour updated",
        color is null
            ? $"{fullName}'s colour was cleared."
            : $"{fullName}'s colour was updated.",
        false));

    return Results.Ok(new { updated = true, color });
});

app.MapGet("/api/test/customer-search", async (NpgsqlDataSource db, string query, int? limit) =>
{
    var take = Math.Clamp(limit ?? 100, 1, 500);
    var search = query.Trim();
    var like = $"%{search.ToLower(CultureInfo.InvariantCulture)}%";
    var normalizedLike = $"%{TextNormalizer.NormalizeOrganisationName(search)}%";

    const string sql = """
        select
          c.customer_ref,
          o.display_name,
          c.mid,
          c.trading_name,
          a.line1,
          a.town,
          a.county,
          coalesce(a.postcode, a.normalized_postcode),
          c.start_date,
          c.status,
          c.source_url
        from paymentsense_core.customers c
        join paymentsense_core.organisations o on o.id = c.organisation_id
        left join lateral (
          select line1, town, county, postcode, normalized_postcode
          from paymentsense_core.addresses
          where organisation_id = o.id
          order by id
          limit 1
        ) a on true
        where @query = ''
           or lower(coalesce(c.customer_ref, '')) like @like
           or lower(coalesce(c.mid, '')) like @like
           or lower(o.display_name) like @like
           or lower(coalesce(c.trading_name, '')) like @like
           or lower(coalesce(a.postcode, a.normalized_postcode, '')) like @like
           or lower(o.normalized_name) like @normalized_like
           or lower(coalesce(c.normalized_trading_name, '')) like @normalized_like
        order by c.updated_at desc
        limit @limit
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("query", search);
    command.Parameters.AddWithValue("like", like);
    command.Parameters.AddWithValue("normalized_like", normalizedLike);
    command.Parameters.AddWithValue("limit", take);

    var rows = new List<CustomerSearchRowResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new CustomerSearchRowResponse(
            reader.GetNullableString(0),
            reader.GetString(1),
            reader.GetNullableString(2),
            reader.GetNullableString(3),
            reader.GetNullableString(4),
            reader.GetNullableString(5),
            reader.GetNullableString(6),
            reader.GetNullableString(7),
            reader.IsDBNull(8) ? null : reader.GetFieldValue<DateOnly>(8),
            TextNormalizer.NormalizeStatus(reader.GetNullableString(9)),
            reader.GetNullableString(10),
            true));
    }

    return Results.Ok(new CustomerSearchPreviewResponse(
        search,
        $"https://search.paymentsense.com/?query={Uri.EscapeDataString(search)}",
        rows));
});

app.MapPost("/api/test/customer-search/live", async (NpgsqlDataSource db, CustomerSearchRequest request) =>
{
    var query = request.Query.Trim();
    if (string.IsNullOrWhiteSpace(query))
    {
        return Results.BadRequest(new { error = "Query is required." });
    }

    if (request.RegionId.HasValue && await ResolveRegionNameAsync(db, request.RegionId) is null)
    {
        return Results.BadRequest(new { error = "Selected region was not found." });
    }

    LiveCustomerExtraction extraction;
    try
    {
        extraction = await PaymentsenseExtractor.ExtractCustomersAsync(query);
    }
    catch (InvalidOperationException exception)
    {
        return Results.Problem(
            title: "Paymentsense customer import is unavailable.",
            detail: $"{exception.Message} Refresh the Paymentsense sign-in session for the Docker API runtime and try again.",
            statusCode: StatusCodes.Status502BadGateway);
    }

    if (request.PersistToDatabase)
    {
        await SaveCustomerExtractionAsync(db, extraction, request.RegionId);
    }
    var storedCustomerKeys = request.PersistToDatabase
        ? extraction.Rows
            .Select(row => row.Mid ?? row.CustomerRef)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .ToHashSet(StringComparer.OrdinalIgnoreCase)
        : await LoadStoredCustomerKeysAsync(
            db,
            extraction.Rows
                .Select(row => row.Mid ?? row.CustomerRef)
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value!)
                .ToArray());

    return Results.Ok(new CustomerSearchPreviewResponse(
        extraction.Query,
        extraction.SearchUrl,
        extraction.Rows.Select(row => new CustomerSearchRowResponse(
            row.CustomerRef,
            row.Entity ?? "",
            row.Mid,
            row.TradingName,
            row.TradingAddress,
            TextNormalizer.SplitAddress(row.TradingAddress).Town,
            TextNormalizer.SplitAddress(row.TradingAddress).County,
            row.TradingPostcode,
            TextNormalizer.TryParseUkDate(row.StartDate),
            TextNormalizer.NormalizeStatus(row.Status),
            row.SourceUrl,
            !string.IsNullOrWhiteSpace(row.Mid ?? row.CustomerRef) && storedCustomerKeys.Contains((row.Mid ?? row.CustomerRef)!))).ToList()));
});

app.MapPost("/api/test/customer-row/insert", async (NpgsqlDataSource db, HttpRequest httpRequest, CustomerSearchRowInsertRequest request) =>
{
    var regionName = await ResolveRegionNameAsync(db, request.RegionId);
    if (request.RegionId.HasValue && regionName is null)
    {
        return Results.BadRequest(new { error = "Selected region was not found." });
    }

    var row = new LiveCustomerRow(
        request.CustomerRef,
        request.Entity,
        request.Mid,
        request.TradingName,
        request.TradingAddress,
        request.TradingPostcode,
        request.StartDate,
        request.Status,
        request.SourceUrl);
    var extraction = new LiveCustomerExtraction(
        request.Entity ?? request.TradingName ?? request.CustomerRef ?? request.Mid ?? "manual insert",
        request.SourceUrl ?? "manual-insert",
        DateTime.UtcNow,
        [row]);
    await SaveCustomerExtractionAsync(db, extraction, request.RegionId);
    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "customer.imported",
        "customer",
        null,
        actor.UserId,
        actor.Name,
        "Customer added",
        $"{BuildCustomerLabel(request.CustomerRef, request.Mid, request.Entity ?? request.TradingName ?? "Customer")} was added from import{(regionName is null ? "." : $" in {regionName}.")}",
        true));
    return Results.Ok(new { added = true });
});

app.MapPost("/api/test/customer-row/remove", async (NpgsqlDataSource db, HttpRequest httpRequest, CustomerSearchRowInsertRequest request) =>
{
    var removed = await RemoveImportedCustomerAsync(db, request);
    if (removed.Status == ArchiveStatus.Success)
    {
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "customer.removed",
            "customer",
            null,
            actor.UserId,
            actor.Name,
            "Customer removed",
            $"{BuildCustomerLabel(request.CustomerRef, request.Mid, request.Entity ?? request.TradingName ?? "Customer")} was removed.",
            true));
    }

    return removed.Status switch
    {
        ArchiveStatus.Success => Results.Ok(new { removed = true }),
        ArchiveStatus.NotFound => Results.NotFound(new { error = removed.ErrorMessage ?? "Customer not found." }),
        ArchiveStatus.Blocked => Results.Conflict(new { error = removed.ErrorMessage ?? "Customer cannot be removed." }),
        _ => Results.BadRequest(new { error = removed.ErrorMessage ?? "Customer remove failed." })
    };
});

app.MapGet("/api/test/paymentsense-auth-status", async () =>
{
    try
    {
        var status = await PaymentsenseExtractor.GetAuthenticationStatusAsync();
        return Results.Ok(status);
    }
    catch (Exception exception) when (exception is InvalidOperationException or FileNotFoundException)
    {
        return Results.Problem(
            title: "Paymentsense auth status is unavailable.",
            detail: exception.Message,
            statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapGet("/api/test/prospect-search", async (NpgsqlDataSource db, string query, int? limit) =>
{
    var take = Math.Clamp(limit ?? 100, 1, 500);
    var search = query.Trim();
    var like = $"%{search.ToLower(CultureInfo.InvariantCulture)}%";
    var normalizedLike = $"%{TextNormalizer.NormalizeOrganisationName(search)}%";

    const string sql = """
        select
          p.prospect_id,
          o.display_name,
          c.full_name,
          c.email,
          p.created_on,
          p.owner_name,
          p.sales_url,
          exists (
            select 1
            from paymentsense_raw.extracted_records r
            where r.record_type = 'prospect_detail'
              and r.external_id = p.prospect_id
              and r.raw_payload->>'extractorVersion' = '2'
          ) as has_stored_detail
        from paymentsense_core.prospects p
        join paymentsense_core.organisations o on o.id = p.organisation_id
        left join lateral (
          select full_name, email
          from paymentsense_core.contacts
          where organisation_id = o.id
          order by id
          limit 1
        ) c on true
        where @query = ''
           or lower(p.prospect_id) like @like
           or lower(o.display_name) like @like
           or lower(o.normalized_name) like @normalized_like
           or lower(coalesce(c.full_name, '')) like @like
           or lower(coalesce(c.email, '')) like @like
        order by p.updated_at desc
        limit @limit
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("query", search);
    command.Parameters.AddWithValue("like", like);
    command.Parameters.AddWithValue("normalized_like", normalizedLike);
    command.Parameters.AddWithValue("limit", take);

    var rows = new List<ProspectSearchRowResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new ProspectSearchRowResponse(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetNullableString(2),
            reader.GetNullableString(3),
            reader.IsDBNull(4) ? null : reader.GetFieldValue<DateOnly>(4),
            reader.GetNullableString(5),
            reader.GetNullableString(6),
            null,
            reader.GetBoolean(7),
            true));
    }

    var postcodes = await LoadProspectPostcodesByRefAsync(db, rows.Select(row => row.ProspectId).ToArray());
    rows = rows
        .Select(row => row with
        {
            Postcode = postcodes.TryGetValue(row.ProspectId, out var postcode) ? postcode : null
        })
        .ToList();

    return Results.Ok(new ProspectSearchPreviewResponse(
        search,
        $"https://search.paymentsense.com/?query={Uri.EscapeDataString(search)}",
        rows,
        false,
        null,
        null));
});

app.MapGet("/api/test/prospect-search/cache", async (NpgsqlDataSource db, string query) =>
{
    var cached = await LoadCachedProspectSearchAsync(db, query);
    return cached is null
        ? Results.NotFound(new { error = "No saved prospect search found." })
        : Results.Ok(cached);
});

app.MapPost("/api/test/prospect-search/live", async (NpgsqlDataSource db, ProspectSearchRequest request) =>
{
    var query = request.Query.Trim();
    if (string.IsNullOrWhiteSpace(query))
    {
        return Results.BadRequest(new { error = "Query is required." });
    }

    LiveProspectExtraction extraction;
    try
    {
        extraction = await PaymentsenseExtractor.ExtractProspectsAsync(query);
    }
    catch (InvalidOperationException exception)
    {
        return Results.Problem(
            title: "Paymentsense prospect import is unavailable.",
            detail: $"{exception.Message} Refresh the Paymentsense sign-in session for the Docker API runtime and try again.",
            statusCode: StatusCodes.Status502BadGateway);
    }

    await SaveOwnedChecklistAsync(db, extraction.Rows);
    await SaveProspectSearchCacheAsync(db, extraction);
    if (request.PersistToDatabase)
    {
        await SaveProspectExtractionAsync(db, extraction);
    }
    var prospectIds = extraction.Rows
        .Select(row => row.ProspectId)
        .Where(id => !string.IsNullOrWhiteSpace(id))
        .Cast<string>()
        .ToArray();
    var detailFlags = await LoadProspectStoredDetailFlagsAsync(
        db,
        prospectIds);
    var postcodes = await LoadProspectPostcodesByRefAsync(db, prospectIds);
    var storedProspectIds = request.PersistToDatabase
        ? prospectIds.ToHashSet(StringComparer.OrdinalIgnoreCase)
        : await LoadStoredProspectIdsAsync(db, prospectIds);

    return Results.Ok(new ProspectSearchPreviewResponse(
        extraction.Query,
        extraction.SearchUrl,
        extraction.Rows.Select(row => new ProspectSearchRowResponse(
            row.ProspectId ?? "",
            row.BusinessName ?? "",
            row.ContactName,
            row.ContactEmail,
            TextNormalizer.TryParseUkDate(row.CreatedOn),
            row.OwnerName,
            row.SourceUrl,
            row.ProspectId is not null && postcodes.TryGetValue(row.ProspectId, out var postcode) ? postcode : null,
            row.ProspectId is not null && detailFlags.Contains(row.ProspectId),
            row.ProspectId is not null && storedProspectIds.Contains(row.ProspectId)))
            .ToList(),
        false,
        null,
        null));
});

app.MapPost("/api/test/prospect-row/insert", async (NpgsqlDataSource db, HttpRequest httpRequest, ProspectSearchRowInsertRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.ProspectId))
    {
        return Results.BadRequest(new { error = "ProspectId is required." });
    }

    var row = new LiveProspectRow(
        request.ProspectId,
        request.BusinessName,
        request.ContactName,
        request.ContactEmail,
        request.CreatedOn,
        request.OwnerName,
        request.SourceUrl);
    var extraction = new LiveProspectExtraction(
        request.BusinessName ?? request.ProspectId,
        request.SourceUrl ?? "manual-insert",
        DateTime.UtcNow,
        [row]);
    await SaveProspectExtractionAsync(db, extraction);
    if (request.Detail is not null)
    {
        await SaveProspectDetailAsync(db, request.Detail.ToLiveProspectDetail(request.ProspectId, request.SourceUrl));
    }
    var actor = await ResolveActivityActorAsync(db, httpRequest);
    await LogActivityEventAsync(db, new ActivityEventCreateRequest(
        "prospect.imported",
        "prospect",
        null,
        actor.UserId,
        actor.Name,
        "Prospect added",
        $"{request.BusinessName ?? request.ProspectId ?? "Prospect"} was added from import.",
        false));
    return Results.Ok(new { added = true });
});

app.MapPost("/api/test/prospect-row/remove", async (NpgsqlDataSource db, HttpRequest httpRequest, ProspectSearchRowInsertRequest request) =>
{
    var removed = await RemoveImportedProspectAsync(db, request);
    if (removed.Status == ArchiveStatus.Success)
    {
        var actor = await ResolveActivityActorAsync(db, httpRequest);
        await LogActivityEventAsync(db, new ActivityEventCreateRequest(
            "prospect.removed",
            "prospect",
            null,
            actor.UserId,
            actor.Name,
            "Prospect removed",
            $"{request.BusinessName ?? request.ProspectId ?? "Prospect"} was removed.",
            false));
    }

    return removed.Status switch
    {
        ArchiveStatus.Success => Results.Ok(new { removed = true }),
        ArchiveStatus.NotFound => Results.NotFound(new { error = removed.ErrorMessage ?? "Prospect not found." }),
        ArchiveStatus.Blocked => Results.Conflict(new { error = removed.ErrorMessage ?? "Prospect cannot be removed." }),
        _ => Results.BadRequest(new { error = removed.ErrorMessage ?? "Prospect remove failed." })
    };
});

app.MapGet("/api/test/prospect-detail/{prospectId}", async (NpgsqlDataSource db, string prospectId, bool? persist) =>
{
    var existing = await LoadProspectDetailAsync(db, prospectId, extractedNow: false);
    if (existing is not null)
    {
        return Results.Ok(existing);
    }

    var detail = await PaymentsenseExtractor.ExtractProspectDetailAsync(prospectId);
    if (persist == false)
    {
        return Results.Ok(MapLiveProspectDetailToResponse(detail, extractedNow: true));
    }

    await SaveProspectDetailAsync(db, detail);

    return Results.Ok(await LoadProspectDetailAsync(db, prospectId, extractedNow: true)
        ?? throw new InvalidOperationException("Prospect detail was extracted but could not be loaded."));
});

app.MapGet("/api/matches", async (NpgsqlDataSource db, string? status, int? limit) =>
{
    var take = Math.Clamp(limit ?? 50, 1, 200);
    var matchStatus = string.IsNullOrWhiteSpace(status) ? "candidate" : status;

    const string sql = """
        select
          m.id,
          m.score,
          m.match_status,
          m.reasons::text,
          p.prospect_id,
          po.display_name as prospect_name,
          c.customer_ref,
          c.mid,
          co.display_name as customer_name,
          m.generated_at
        from paymentsense_core.match_candidates m
        join paymentsense_core.prospects p on p.id = m.prospect_id
        join paymentsense_core.organisations po on po.id = p.organisation_id
        join paymentsense_core.customers c on c.id = m.customer_id
        join paymentsense_core.organisations co on co.id = c.organisation_id
        where m.match_status = @status
        order by m.score desc, m.generated_at desc
        limit @limit
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("status", matchStatus);
    command.Parameters.AddWithValue("limit", take);

    var rows = new List<MatchCandidateResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new MatchCandidateResponse(
            reader.GetInt64(0),
            reader.GetDecimal(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetString(4),
            reader.GetString(5),
            reader.GetNullableString(6),
            reader.GetNullableString(7),
            reader.GetString(8),
            reader.GetDateTime(9)));
    }

    return Results.Ok(rows);
});

app.MapPost("/api/lab/seed-example", async (NpgsqlDataSource db) =>
{
    const string sql = """
        with prospect_org as (
          insert into paymentsense_core.organisations (display_name, normalized_name, source_confidence)
          values ('IDEAL REPAIR AND MAINTENANCE', 'ideal repair maintenance', 0.9800)
          on conflict do nothing
          returning id
        ),
        prospect_org_id as (
          select id from prospect_org
          union all
          select id from paymentsense_core.organisations where normalized_name = 'ideal repair maintenance'
          limit 1
        ),
        prospect_upsert as (
          insert into paymentsense_core.prospects (
            organisation_id,
            prospect_id,
            channel,
            origin,
            created_on,
            sales_url,
            has_paymentsense_customer_match
          )
          select
            id,
            'PR000130676-GB',
            'Manual Referral',
            'Platinum Foods Limited (SP248134I-GB)',
            '2022-07-16'::date,
            'https://sales.paymentsense.com/prospect/PR000130676-GB',
            true
          from prospect_org_id
          on conflict (prospect_id) do update set
            has_paymentsense_customer_match = excluded.has_paymentsense_customer_match,
            updated_at = now()
          returning id
        ),
        customer_upsert as (
          insert into paymentsense_core.customers (
            organisation_id,
            customer_kind,
            customer_ref,
            mid,
            trading_name,
            normalized_trading_name,
            start_date,
            status,
            customer_activity_status_id
          )
          select
            prospect_org_id.id,
            'customer',
            'SP193020Y-GB',
            '202016558622447',
            'Ideal Tyres',
            'ideal tyres',
            '2025-10-14'::date,
            'possible_match',
            (
              select id
              from paymentsense_core.customer_activity_statuses
              where normalized_name = 'active'
              limit 1
            )
          from prospect_org_id
          on conflict (mid) do update set
            trading_name = excluded.trading_name,
            updated_at = now()
          returning id
        ),
        address_insert as (
          insert into paymentsense_core.addresses (
            organisation_id,
            label,
            line1,
            town,
            county,
            postcode,
            normalized_postcode
          )
          select id, 'trading', '10B Manor Way', 'Woking', 'Surrey', 'GU22 9JX', 'GU229JX'
          from prospect_org_id
          where not exists (
            select 1 from paymentsense_core.addresses a
            where a.organisation_id = prospect_org_id.id and a.normalized_postcode = 'GU229JX'
          )
        ),
        contact_insert as (
          insert into paymentsense_core.contacts (
            organisation_id,
            full_name,
            normalized_name,
            email,
            normalized_email,
            phone,
            normalized_phone
          )
          select id, 'TANVIR ASLAM', 'tanvir aslam', 'ideal.tyres@yahoo.co.uk', 'ideal.tyres@yahoo.co.uk', '+447533897756', '447533897756'
          from prospect_org_id
          where not exists (
            select 1 from paymentsense_core.contacts c
            where c.organisation_id = prospect_org_id.id and c.normalized_email = 'ideal.tyres@yahoo.co.uk'
          )
        )
        insert into paymentsense_core.match_candidates (
          prospect_id,
          customer_id,
          score,
          match_status,
          reasons
        )
        select
          p.id,
          c.id,
          0.9200,
          'candidate',
          '["same postcode", "similar organisation name", "sales page flags customer match"]'::jsonb
        from prospect_upsert p
        cross join customer_upsert c
        on conflict (prospect_id, customer_id) do update set
          score = excluded.score,
          reasons = excluded.reasons,
          generated_at = now()
        returning id
        """;

    await using var command = db.CreateCommand(sql);
    var id = await command.ExecuteScalarAsync();
    return Results.Ok(new { seeded = true, matchCandidateId = id });
});

app.Run();

static async Task<IReadOnlyList<ActivityEventResponse>> LoadActivityEventsAsync(NpgsqlDataSource db, int take)
{
    const string sql = """
        select
          e.id,
          e.event_type,
          e.entity_type,
          e.entity_id,
          e.title,
          e.description,
          e.actor_user_id,
          coalesce(u.full_name, e.actor_name_snapshot),
          e.created_at,
          e.is_notifiable
        from paymentsense_core.activity_events e
        left join paymentsense_core.users u on u.id = e.actor_user_id
        order by e.created_at desc, e.id desc
        limit @limit
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("limit", take);

    var rows = new List<ActivityEventResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new ActivityEventResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetInt64(3),
            reader.GetString(4),
            reader.GetString(5),
            reader.IsDBNull(6) ? null : reader.GetInt64(6),
            reader.GetNullableString(7),
            reader.GetDateTime(8),
            reader.GetBoolean(9)));
    }

    return rows;
}

static async Task<string?> LoadAppSettingAsync(NpgsqlDataSource db, string settingKey)
{
    await using var command = db.CreateCommand("""
        select value_text
        from paymentsense_core.app_settings
        where setting_key = @setting_key
        """);
    command.Parameters.AddWithValue("setting_key", settingKey);
    return await command.ExecuteScalarAsync() as string;
}

static async Task SaveAppSettingAsync(NpgsqlDataSource db, string settingKey, string? value)
{
    await using var command = db.CreateCommand("""
        insert into paymentsense_core.app_settings (
          setting_key,
          value_text
        )
        values (
          @setting_key,
          @value_text
        )
        on conflict (setting_key) do update
        set
          value_text = excluded.value_text,
          updated_at = now()
        """);
    command.Parameters.AddWithValue("setting_key", settingKey);
    command.Parameters.AddWithValue("value_text", (object?)value ?? DBNull.Value);
    await command.ExecuteNonQueryAsync();
}

static async Task<IReadOnlyList<AiCompanyInsightResponse>> LoadAiCompanyInsightsAsync(NpgsqlDataSource db)
{
    const string sql = """
        select
          insight.id,
          insight.search_name,
          insight.search_location,
          insight.company_name,
          insight.company_number,
          insight.status,
          insight.insight_json::text,
          insight.created_by_user_id,
          u.full_name,
          insight.created_at,
          insight.updated_at
        from paymentsense_core.ai_company_insights insight
        left join paymentsense_core.users u on u.id = insight.created_by_user_id
        order by insight.updated_at desc, insight.id desc
        """;

    await using var command = db.CreateCommand(sql);
    var rows = new List<AiCompanyInsightResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new AiCompanyInsightResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetNullableString(2),
            reader.GetString(3),
            reader.GetString(4),
            reader.GetNullableString(5),
            NormalizeInsightElement(JsonDocument.Parse(reader.GetString(6)).RootElement).Clone(),
            reader.IsDBNull(7) ? null : reader.GetInt64(7),
            reader.GetNullableString(8),
            reader.GetDateTime(9),
            reader.GetDateTime(10)));
    }

    return rows;
}

static async Task<AiCompanyInsightResponse?> LoadAiCompanyInsightByIdAsync(NpgsqlDataSource db, long insightId)
{
    const string sql = """
        select
          insight.id,
          insight.search_name,
          insight.search_location,
          insight.company_name,
          insight.company_number,
          insight.status,
          insight.insight_json::text,
          insight.created_by_user_id,
          u.full_name,
          insight.created_at,
          insight.updated_at
        from paymentsense_core.ai_company_insights insight
        left join paymentsense_core.users u on u.id = insight.created_by_user_id
        where insight.id = @id
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("id", insightId);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    return new AiCompanyInsightResponse(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.GetNullableString(2),
        reader.GetString(3),
        reader.GetString(4),
        reader.GetNullableString(5),
        NormalizeInsightElement(JsonDocument.Parse(reader.GetString(6)).RootElement).Clone(),
        reader.IsDBNull(7) ? null : reader.GetInt64(7),
        reader.GetNullableString(8),
        reader.GetDateTime(9),
        reader.GetDateTime(10));
}

static async Task<IReadOnlyList<QueuedJobResponse>> LoadQueuedJobsAsync(
    NpgsqlDataSource db,
    string? searchText,
    string? status,
    string? jobType,
    bool includeRemoved)
{
    var rows = new List<QueuedJobResponse>();
    await using var command = db.CreateCommand("""
        select
          j.id,
          j.job_type,
          j.display_name,
          j.status,
          j.payload_json::text,
          j.result_json::text,
          j.requested_by_user_id,
          requested_by.full_name,
          j.scheduled_for,
          j.queued_at,
          j.started_at,
          j.completed_at,
          j.last_heartbeat_at,
          j.attempt_count,
          j.max_attempts,
          j.cancel_requested,
          j.current_step,
          j.error_text,
          j.removed_at,
          j.removed_by_user_id,
          removed_by.full_name,
          j.created_at,
          j.updated_at
        from paymentsense_core.queued_jobs j
        left join paymentsense_core.users requested_by on requested_by.id = j.requested_by_user_id
        left join paymentsense_core.users removed_by on removed_by.id = j.removed_by_user_id
        where (@include_removed or j.removed_at is null)
          and (coalesce(@status, '') = '' or j.status = @status)
          and (coalesce(@job_type, '') = '' or j.job_type = @job_type)
          and (
            coalesce(@search_text, '') = ''
            or j.display_name ilike '%' || @search_text || '%'
            or j.job_type ilike '%' || @search_text || '%'
            or coalesce(requested_by.full_name, '') ilike '%' || @search_text || '%'
          )
        order by j.created_at desc, j.id desc
        limit 500
        """);
    command.Parameters.AddWithValue("include_removed", includeRemoved);
    command.Parameters.AddWithValue("status", (object?)NullIfBlank(status) ?? DBNull.Value);
    command.Parameters.AddWithValue("job_type", (object?)NullIfBlank(jobType) ?? DBNull.Value);
    command.Parameters.AddWithValue("search_text", (object?)NullIfBlank(searchText) ?? DBNull.Value);

    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new QueuedJobResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            JsonDocument.Parse(reader.GetString(4)).RootElement.Clone(),
            reader.IsDBNull(5) ? null : JsonDocument.Parse(reader.GetString(5)).RootElement.Clone(),
            reader.IsDBNull(6) ? null : reader.GetInt64(6),
            reader.GetNullableString(7),
            reader.GetDateTime(8),
            reader.IsDBNull(9) ? null : reader.GetDateTime(9),
            reader.IsDBNull(10) ? null : reader.GetDateTime(10),
            reader.IsDBNull(11) ? null : reader.GetDateTime(11),
            reader.IsDBNull(12) ? null : reader.GetDateTime(12),
            reader.GetInt32(13),
            reader.GetInt32(14),
            reader.GetBoolean(15),
            reader.GetNullableString(16),
            reader.GetNullableString(17),
            reader.IsDBNull(18) ? null : reader.GetDateTime(18),
            reader.IsDBNull(19) ? null : reader.GetInt64(19),
            reader.GetNullableString(20),
            reader.GetDateTime(21),
            reader.GetDateTime(22)));
    }

    return rows;
}

static async Task<QueuedJobResponse?> LoadQueuedJobByIdAsync(NpgsqlDataSource db, long jobId)
{
    return (await LoadQueuedJobsAsync(db, null, null, null, includeRemoved: true))
        .FirstOrDefault(row => row.Id == jobId);
}

static async Task<long> CreateQueuedJobAsync(
    NpgsqlDataSource db,
    string jobType,
    string displayName,
    string payloadJson,
    long? requestedByUserId,
    DateTime scheduledFor)
{
    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    long jobId;
    await using (var command = new NpgsqlCommand("""
        insert into paymentsense_core.queued_jobs (
          job_type,
          display_name,
          status,
          payload_json,
          requested_by_user_id,
          scheduled_for
        )
        values (
          @job_type,
          @display_name,
          'pending',
          @payload_json::jsonb,
          @requested_by_user_id,
          @scheduled_for
        )
        returning id
        """, connection, transaction))
    {
        command.Parameters.AddWithValue("job_type", jobType);
        command.Parameters.AddWithValue("display_name", displayName);
        command.Parameters.AddWithValue("payload_json", payloadJson);
        command.Parameters.AddWithValue("requested_by_user_id", (object?)requestedByUserId ?? DBNull.Value);
        command.Parameters.AddWithValue("scheduled_for", scheduledFor);
        jobId = (long)(await command.ExecuteScalarAsync() ?? 0L);
    }

    await using (var command = new NpgsqlCommand("""
        insert into paymentsense_core.job_outbox (job_id, event_type)
        values (@job_id, 'enqueue')
        """, connection, transaction))
    {
        command.Parameters.AddWithValue("job_id", jobId);
        await command.ExecuteNonQueryAsync();
    }

    await transaction.CommitAsync();
    return jobId;
}

static async Task<QueuedJobSummaryResponse> LoadQueuedJobSummaryAsync(NpgsqlDataSource db)
{
    await using var command = db.CreateCommand("""
        select
          count(*) filter (where removed_at is null),
          count(*) filter (where removed_at is null and status = 'pending'),
          count(*) filter (where removed_at is null and status = 'queued'),
          count(*) filter (where removed_at is null and status = 'running'),
          count(*) filter (where removed_at is null and status = 'completed'),
          count(*) filter (where removed_at is null and status = 'failed'),
          count(*) filter (where removed_at is null and status = 'cancel_requested'),
          count(*) filter (where removed_at is null and status = 'cancelled')
        from paymentsense_core.queued_jobs
        """);
    await using var reader = await command.ExecuteReaderAsync();
    await reader.ReadAsync();

    return new QueuedJobSummaryResponse(
        reader.GetInt64(0),
        reader.GetInt64(1),
        reader.GetInt64(2),
        reader.GetInt64(3),
        reader.GetInt64(4),
        reader.GetInt64(5),
        reader.GetInt64(6),
        reader.GetInt64(7));
}

static async Task<QueueMetricsResponse> LoadRabbitQueueMetricsAsync(
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory,
    string queueName)
{
    var baseUrl = configuration["RabbitMq:ManagementBaseUrl"] ?? "http://localhost:15672";
    var username = configuration["RabbitMq:Username"] ?? "admin";
    var password = configuration["RabbitMq:Password"] ?? "SuperSecret123!";
    var client = httpClientFactory.CreateClient();
    var token = Convert.ToBase64String(System.Text.Encoding.ASCII.GetBytes($"{username}:{password}"));
    using var request = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl.TrimEnd('/')}/api/queues/%2F/{Uri.EscapeDataString(queueName)}");
    request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", token);

    try
    {
        using var response = await client.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            return new QueueMetricsResponse(queueName, false, 0, 0, 0, $"HTTP {(int)response.StatusCode}");
        }

        await using var stream = await response.Content.ReadAsStreamAsync();
        using var document = await JsonDocument.ParseAsync(stream);
        var root = document.RootElement;
        return new QueueMetricsResponse(
            queueName,
            true,
            root.TryGetProperty("messages_ready", out var ready) ? ready.GetInt32() : 0,
            root.TryGetProperty("messages_unacknowledged", out var unacked) ? unacked.GetInt32() : 0,
            root.TryGetProperty("consumers", out var consumers) ? consumers.GetInt32() : 0,
            null);
    }
    catch (Exception ex)
    {
        return new QueueMetricsResponse(queueName, false, 0, 0, 0, ex.Message);
    }
}

static async Task LinkAiCompanyInsightToCustomerAsync(NpgsqlDataSource db, long customerId, long insightId)
{
    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    await using (var deleteCommand = new NpgsqlCommand("""
        delete from paymentsense_core.customer_ai_company_insights
        where customer_id = @customer_id
          and ai_company_insight_id <> @ai_company_insight_id
        """, connection, transaction))
    {
        deleteCommand.Parameters.AddWithValue("customer_id", customerId);
        deleteCommand.Parameters.AddWithValue("ai_company_insight_id", insightId);
        await deleteCommand.ExecuteNonQueryAsync();
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
        await insertCommand.ExecuteNonQueryAsync();
    }

    await transaction.CommitAsync();
}

static async Task<CustomerAiInsightSummaryResponse?> LoadCustomerAiCompanyInsightAsync(NpgsqlDataSource db, long customerId)
{
    const string sql = """
        select
          insight.id,
          insight.search_name,
          insight.search_location,
          insight.company_name,
          insight.company_number,
          insight.status,
          insight.insight_json::text,
          insight.updated_at
        from paymentsense_core.customer_ai_company_insights link
        join paymentsense_core.ai_company_insights insight on insight.id = link.ai_company_insight_id
        where link.customer_id = @customer_id
        order by link.updated_at desc, insight.updated_at desc, insight.id desc
        limit 1
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("customer_id", customerId);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    var insight = NormalizeInsightElement(JsonDocument.Parse(reader.GetString(6)).RootElement).Clone();
    return new CustomerAiInsightSummaryResponse(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.GetNullableString(2),
        reader.GetString(3),
        reader.GetString(4),
        reader.GetNullableString(5),
        ReadOptionalString(insight, "registeredAddress"),
        ReadOptionalString(insight, "incorporationDate"),
        ReadOptionalString(insight, "natureOfBusiness"),
        ReadOptionalString(insight, "turnover"),
        ReadOptionalString(insight, "employeeCount"),
        ReadOptionalString(insight, "website"),
        ReadDigitalLinks(insight),
        reader.GetDateTime(7));
}

static List<AiInsightDigitalLinkResponse> ReadDigitalLinks(JsonElement insight)
{
    insight = NormalizeInsightElement(insight);
    var result = new List<AiInsightDigitalLinkResponse>();
    if (!insight.TryGetProperty("digitalLinks", out var linksElement) || linksElement.ValueKind != JsonValueKind.Array)
    {
        return result;
    }

    foreach (var item in linksElement.EnumerateArray())
    {
        var label = ReadOptionalString(item, "label");
        var url = ReadOptionalString(item, "url");
        if (string.IsNullOrWhiteSpace(label) || string.IsNullOrWhiteSpace(url))
        {
            continue;
        }

        result.Add(new AiInsightDigitalLinkResponse(label, url));
    }

    return result;
}

static string? ReadOptionalString(JsonElement element, string propertyName)
{
    element = NormalizeInsightElement(element);
    if (!element.TryGetProperty(propertyName, out var property) || property.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
    {
        return null;
    }

    return property.GetString()?.Trim();
}

static string? ReadRequiredString(JsonElement element, string propertyName) =>
    NullIfBlank(ReadOptionalString(element, propertyName));

static HashSet<string> ExtractSicCodesFromInsight(JsonElement insight)
{
    insight = NormalizeInsightElement(insight);
    var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    if (!insight.TryGetProperty("sicCodes", out var sicCodesElement) || sicCodesElement.ValueKind != JsonValueKind.Array)
    {
        return result;
    }

    foreach (var item in sicCodesElement.EnumerateArray())
    {
        var raw = item.GetString()?.Trim();
        if (string.IsNullOrWhiteSpace(raw))
        {
            continue;
        }

        var code = raw.Split(" - ", 2, StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)[0];
        if (!string.IsNullOrWhiteSpace(code))
        {
            result.Add(code);
        }
    }

    return result;
}

static JsonElement NormalizeInsightElement(JsonElement element)
{
    if (element.ValueKind == JsonValueKind.Object)
    {
        return element;
    }

    if (element.ValueKind == JsonValueKind.Array)
    {
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                return item;
            }
        }
    }

    return element;
}

static async Task<List<long>> LoadMatchingCustomersForAiInsightAsync(NpgsqlDataSource db, string companyName, string? searchLocation)
{
    var normalizedName = TextNormalizer.NormalizeOrganisationName(companyName);
    var normalizedPostcode = TextNormalizer.NormalizePostcode(searchLocation);

    await using var command = db.CreateCommand("""
        select distinct c.id
        from paymentsense_core.customers c
        join paymentsense_core.organisations o on o.id = c.organisation_id
        left join lateral (
          select normalized_postcode
          from paymentsense_core.addresses
          where organisation_id = o.id
          order by id
          limit 1
        ) addr on true
        where (
          o.normalized_name = @normalized_name
          or coalesce(c.normalized_trading_name, '') = @normalized_name
        )
        and (
          @normalized_postcode is null
          or coalesce(addr.normalized_postcode, '') = @normalized_postcode
        )
        order by c.id asc
        """);
    command.Parameters.AddWithValue("normalized_name", normalizedName);
    command.Parameters.AddWithValue("normalized_postcode", (object?)normalizedPostcode ?? DBNull.Value);

    var result = new List<long>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        result.Add(reader.GetInt64(0));
    }

    return result;
}

static async Task<ActivityActorContext> ResolveActivityActorAsync(NpgsqlDataSource db, HttpRequest httpRequest)
{
    if (!long.TryParse(httpRequest.Headers["X-Actor-User-Id"], out var actorUserId) || actorUserId <= 0)
    {
        return new ActivityActorContext(null, null);
    }

    await using var command = db.CreateCommand("""
        select full_name
        from paymentsense_core.users
        where id = @user_id
        """);
    command.Parameters.AddWithValue("user_id", actorUserId);
    var actorName = await command.ExecuteScalarAsync() as string;
    return new ActivityActorContext(actorUserId, actorName);
}

static async Task LogActivityEventAsync(NpgsqlDataSource db, ActivityEventCreateRequest activityEvent)
{
    await using var command = db.CreateCommand("""
        insert into paymentsense_core.activity_events (
          event_type,
          entity_type,
          entity_id,
          actor_user_id,
          actor_name_snapshot,
          title,
          description,
          is_notifiable,
          metadata_json
        )
        values (
          @event_type,
          @entity_type,
          @entity_id,
          @actor_user_id,
          @actor_name_snapshot,
          @title,
          @description,
          @is_notifiable,
          @metadata_json::jsonb
        )
        """);
    command.Parameters.AddWithValue("event_type", activityEvent.EventType);
    command.Parameters.AddWithValue("entity_type", activityEvent.EntityType);
    command.Parameters.AddWithValue("entity_id", (object?)activityEvent.EntityId ?? DBNull.Value);
    command.Parameters.AddWithValue("actor_user_id", (object?)activityEvent.ActorUserId ?? DBNull.Value);
    command.Parameters.AddWithValue("actor_name_snapshot", (object?)activityEvent.ActorName ?? DBNull.Value);
    command.Parameters.AddWithValue("title", activityEvent.Title);
    command.Parameters.AddWithValue("description", activityEvent.Description);
    command.Parameters.AddWithValue("is_notifiable", activityEvent.IsNotifiable);
    command.Parameters.AddWithValue("metadata_json", JsonSerializer.Serialize(activityEvent.Metadata ?? new Dictionary<string, object?>(), JsonDefaults.Options));
    await command.ExecuteNonQueryAsync();
}

static async Task<CustomerActivitySummary?> LoadCustomerActivitySummaryAsync(NpgsqlDataSource db, long customerId)
{
    await using var command = db.CreateCommand("""
        select c.id, c.customer_ref, c.mid, o.display_name, c.suppression_reason, c.assigned_user_id
        from paymentsense_core.customers c
        join paymentsense_core.organisations o on o.id = c.organisation_id
        where c.id = @customer_id
        """);
    command.Parameters.AddWithValue("customer_id", customerId);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    return new CustomerActivitySummary(
        reader.GetInt64(0),
        reader.GetNullableString(1),
        reader.GetNullableString(2),
        reader.GetString(3),
        reader.GetNullableString(4),
        reader.IsDBNull(5) ? null : reader.GetInt64(5));
}

static async Task<ProspectActivitySummary?> LoadProspectActivitySummaryAsync(NpgsqlDataSource db, long prospectId)
{
    await using var command = db.CreateCommand("""
        select p.id, p.prospect_id, o.display_name
        from paymentsense_core.prospects p
        join paymentsense_core.organisations o on o.id = p.organisation_id
        where p.id = @prospect_id
        """);
    command.Parameters.AddWithValue("prospect_id", prospectId);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    return new ProspectActivitySummary(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.GetString(2));
}

static async Task<LeadActivitySummary?> LoadLeadActivitySummaryAsync(NpgsqlDataSource db, long leadId)
{
    await using var command = db.CreateCommand("""
        select
          l.id,
          l.customer_id,
          co.display_name,
          c.customer_ref,
          c.mid,
          l.lead_status,
          l.lead_priority,
          l.assigned_user_id,
          u.full_name
        from paymentsense_core.leads l
        join paymentsense_core.customers c on c.id = l.customer_id
        join paymentsense_core.organisations co on co.id = c.organisation_id
        left join paymentsense_core.users u on u.id = l.assigned_user_id
        where l.id = @lead_id
        """);
    command.Parameters.AddWithValue("lead_id", leadId);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    return new LeadActivitySummary(
        reader.GetInt64(0),
        reader.GetInt64(1),
        reader.GetString(2),
        reader.GetNullableString(3),
        reader.GetNullableString(4),
        reader.GetString(5),
        reader.GetString(6),
        reader.IsDBNull(7) ? null : reader.GetInt64(7),
        reader.GetNullableString(8));
}

static async Task<MatchActivitySummary?> LoadMatchActivitySummaryAsync(NpgsqlDataSource db, long customerId, long matchId)
{
    await using var command = db.CreateCommand("""
        select
          m.id,
          c.id,
          c.customer_ref,
          c.mid,
          co.display_name,
          p.prospect_id,
          po.display_name
        from paymentsense_core.match_candidates m
        join paymentsense_core.customers c on c.id = m.customer_id
        join paymentsense_core.organisations co on co.id = c.organisation_id
        join paymentsense_core.prospects p on p.id = m.prospect_id
        join paymentsense_core.organisations po on po.id = p.organisation_id
        where m.customer_id = @customer_id
          and m.id = @match_id
        """);
    command.Parameters.AddWithValue("customer_id", customerId);
    command.Parameters.AddWithValue("match_id", matchId);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    return new MatchActivitySummary(
        reader.GetInt64(0),
        reader.GetInt64(1),
        reader.GetNullableString(2),
        reader.GetNullableString(3),
        reader.GetString(4),
        reader.GetString(5),
        reader.GetString(6));
}

static async Task<CampaignWaveActivitySummary?> LoadCampaignWaveActivitySummaryAsync(NpgsqlDataSource db, long campaignId, string waveName, int waveNumber)
{
    await using var command = db.CreateCommand("""
        select cw.id, c.name, cw.name, cw.wave_number
        from paymentsense_core.campaign_waves cw
        join paymentsense_core.campaigns c on c.id = cw.campaign_id
        where cw.campaign_id = @campaign_id
          and cw.name = @wave_name
          and cw.wave_number = @wave_number
        order by cw.id desc
        limit 1
        """);
    command.Parameters.AddWithValue("campaign_id", campaignId);
    command.Parameters.AddWithValue("wave_name", waveName);
    command.Parameters.AddWithValue("wave_number", waveNumber);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    return new CampaignWaveActivitySummary(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.GetString(2),
        reader.GetInt32(3));
}

static string FormatCustomerLabel(CustomerActivitySummary customer) =>
    BuildCustomerLabel(customer.CustomerRef, customer.Mid, customer.EntityName);

static string BuildCustomerLabel(string? customerRef, string? mid, string entityName)
{
    var key = customerRef ?? mid;
    return string.IsNullOrWhiteSpace(key)
        ? entityName
        : $"{entityName} ({key})";
}

static string FormatProspectLabel(ProspectActivitySummary prospect) =>
    $"{prospect.BusinessName} ({prospect.ProspectId})";

static string FormatLeadLabel(LeadActivitySummary lead)
{
    var key = lead.CustomerRef ?? lead.Mid;
    return string.IsNullOrWhiteSpace(key)
        ? $"Lead #{lead.Id} for {lead.CustomerName}"
        : $"Lead #{lead.Id} for {lead.CustomerName} ({key})";
}

static bool CustomerCommercialsMatch(CustomerCommercialsResponse? existing, CustomerSuppressionUpdateRequest request) =>
    existing?.CreditCardValue == request.CreditCardValue &&
    existing?.ValuePeriod == request.ValuePeriod &&
    existing?.CurrentChargePercent == request.CurrentChargePercent &&
    existing?.ProposedChargePercent == request.ProposedChargePercent &&
    (!request.UpdateCustomerValueType || existing?.CustomerValueTypeId == (request.CustomerValueTypeId is > 0 ? request.CustomerValueTypeId : null));

static async Task SaveCustomerExtractionAsync(NpgsqlDataSource db, LiveCustomerExtraction extraction, long? regionId = null)
{
    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();
    var defaultCustomerActivityStatusId = await ResolveCustomerActivityStatusIdByNameAsync(connection, transaction, "active");

    if (regionId.HasValue)
    {
        await using var regionCheck = new NpgsqlCommand("""
            select exists (
              select 1
              from paymentsense_core.regions
              where id = @region_id
            )
            """, connection, transaction);
        regionCheck.Parameters.AddWithValue("region_id", regionId.Value);
        if ((bool?)await regionCheck.ExecuteScalarAsync() != true)
        {
            throw new InvalidOperationException("Selected region does not exist.");
        }
    }

    long searchRunId;
    await using (var command = new NpgsqlCommand("""
        insert into paymentsense_raw.search_runs (query_text, source_url, completed_at, counts)
        values (@query, @source_url, now(), jsonb_build_object('customers', @customer_count))
        returning id
        """, connection, transaction))
    {
        command.Parameters.AddWithValue("query", extraction.Query);
        command.Parameters.AddWithValue("source_url", extraction.SearchUrl);
        command.Parameters.AddWithValue("customer_count", extraction.Rows.Count);
        searchRunId = (long) (await command.ExecuteScalarAsync() ?? 0L);
    }

    foreach (var row in extraction.Rows)
    {
        var payload = JsonSerializer.Serialize(row, JsonDefaults.Options);
        long rawRecordId;

        await using (var command = new NpgsqlCommand("""
            insert into paymentsense_raw.extracted_records (
              search_run_id,
              record_type,
              external_id,
              source_url,
              raw_payload
            )
            values (
              @search_run_id,
              'customer',
              @external_id,
              @source_url,
              @raw_payload::jsonb
            )
            returning id
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("search_run_id", searchRunId);
            command.Parameters.AddWithValue("external_id", (object?) (row.Mid ?? row.CustomerRef) ?? DBNull.Value);
            command.Parameters.AddWithValue("source_url", (object?) (row.SourceUrl ?? extraction.SearchUrl) ?? DBNull.Value);
            command.Parameters.AddWithValue("raw_payload", payload);
            rawRecordId = (long) (await command.ExecuteScalarAsync() ?? 0L);
        }

        var organisationName = row.Entity ?? row.TradingName ?? row.CustomerRef ?? row.Mid ?? "Unknown customer";
        var normalizedName = TextNormalizer.NormalizeOrganisationName(organisationName);
        if (string.IsNullOrWhiteSpace(normalizedName))
        {
            normalizedName = TextNormalizer.NormalizeOrganisationName(row.TradingName ?? organisationName);
        }

        long organisationId;
        await using (var command = new NpgsqlCommand("""
            insert into paymentsense_core.organisations (display_name, normalized_name, source_confidence)
            values (@display_name, @normalized_name, 0.9000)
            on conflict do nothing
            returning id
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("display_name", organisationName);
            command.Parameters.AddWithValue("normalized_name", normalizedName);
            var result = await command.ExecuteScalarAsync();
            if (result is long id)
            {
                organisationId = id;
            }
            else
            {
                await using var lookup = new NpgsqlCommand("""
                    select id
                    from paymentsense_core.organisations
                    where normalized_name = @normalized_name
                    order by id
                    limit 1
                    """, connection, transaction);
                lookup.Parameters.AddWithValue("normalized_name", normalizedName);
                organisationId = (long) (await lookup.ExecuteScalarAsync() ?? throw new InvalidOperationException("Organisation lookup failed."));
            }
        }

        await using (var command = new NpgsqlCommand("""
            insert into paymentsense_core.customers (
              organisation_id,
              customer_kind,
              customer_ref,
              mid,
              trading_name,
              normalized_trading_name,
              start_date,
              status,
              customer_activity_status_id,
              region_id,
              source_url,
              raw_record_id
            )
            values (
              @organisation_id,
              'customer',
              @customer_ref,
              @mid,
              @trading_name,
              @normalized_trading_name,
              @start_date,
              @status,
              @customer_activity_status_id,
              @region_id,
              @source_url,
              @raw_record_id
            )
            on conflict (mid) do update set
              organisation_id = excluded.organisation_id,
              customer_ref = excluded.customer_ref,
              trading_name = excluded.trading_name,
              normalized_trading_name = excluded.normalized_trading_name,
              start_date = excluded.start_date,
              status = excluded.status,
              customer_activity_status_id = coalesce(paymentsense_core.customers.customer_activity_status_id, excluded.customer_activity_status_id),
              region_id = excluded.region_id,
              source_url = excluded.source_url,
              raw_record_id = excluded.raw_record_id,
              updated_at = now()
            returning id
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("organisation_id", organisationId);
            command.Parameters.AddWithValue("customer_ref", (object?) row.CustomerRef ?? DBNull.Value);
            command.Parameters.AddWithValue("mid", (object?) row.Mid ?? DBNull.Value);
            command.Parameters.AddWithValue("trading_name", (object?) row.TradingName ?? DBNull.Value);
            command.Parameters.AddWithValue("normalized_trading_name", (object?) TextNormalizer.NormalizeOrganisationName(row.TradingName ?? "") ?? DBNull.Value);
            command.Parameters.AddWithValue("start_date", (object?) TextNormalizer.TryParseUkDate(row.StartDate) ?? DBNull.Value);
            command.Parameters.AddWithValue("status", (object?) TextNormalizer.NormalizeStatus(row.Status) ?? DBNull.Value);
            command.Parameters.AddWithValue("customer_activity_status_id", (object?) defaultCustomerActivityStatusId ?? DBNull.Value);
            command.Parameters.AddWithValue("region_id", (object?) regionId ?? DBNull.Value);
            command.Parameters.AddWithValue("source_url", (object?) row.SourceUrl ?? extraction.SearchUrl);
            command.Parameters.AddWithValue("raw_record_id", rawRecordId);
            await command.ExecuteScalarAsync();
        }

        if (!string.IsNullOrWhiteSpace(row.TradingAddress) || !string.IsNullOrWhiteSpace(row.TradingPostcode))
        {
            var address = TextNormalizer.SplitAddress(row.TradingAddress);
            await using var addressCommand = new NpgsqlCommand("""
                insert into paymentsense_core.addresses (
                  organisation_id,
                  label,
                  line1,
                  town,
                  county,
                  postcode,
                  normalized_postcode,
                  source_confidence
                )
                select
                  @organisation_id,
                  'trading',
                  @line1,
                  @town,
                  @county,
                  @postcode,
                  @normalized_postcode,
                  0.8500
                where not exists (
                  select 1
                  from paymentsense_core.addresses
                  where organisation_id = @organisation_id
                    and coalesce(normalized_postcode, '') = coalesce(@normalized_postcode, '')
                    and coalesce(line1, '') = coalesce(@line1, '')
                )
                """, connection, transaction);
            addressCommand.Parameters.AddWithValue("organisation_id", organisationId);
            addressCommand.Parameters.AddWithValue("line1", (object?) address.Line1 ?? DBNull.Value);
            addressCommand.Parameters.AddWithValue("town", (object?) address.Town ?? DBNull.Value);
            addressCommand.Parameters.AddWithValue("county", (object?) address.County ?? DBNull.Value);
            addressCommand.Parameters.AddWithValue("postcode", (object?) row.TradingPostcode ?? DBNull.Value);
            addressCommand.Parameters.AddWithValue("normalized_postcode", (object?) TextNormalizer.NormalizePostcode(row.TradingPostcode) ?? DBNull.Value);
            await addressCommand.ExecuteNonQueryAsync();
        }
    }

    await transaction.CommitAsync();
}

static async Task<string?> ResolveRegionNameAsync(NpgsqlDataSource db, long? regionId)
{
    if (!regionId.HasValue)
    {
        return null;
    }

    await using var command = db.CreateCommand("""
        select name
        from paymentsense_core.regions
        where id = @region_id
        """);
    command.Parameters.AddWithValue("region_id", regionId.Value);
    return await command.ExecuteScalarAsync() as string;
}

static async Task SaveProspectExtractionAsync(NpgsqlDataSource db, LiveProspectExtraction extraction)
{
    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    long searchRunId;
    await using (var command = new NpgsqlCommand("""
        insert into paymentsense_raw.search_runs (query_text, source_url, completed_at, counts)
        values (@query, @source_url, now(), jsonb_build_object('prospects', @prospect_count))
        returning id
        """, connection, transaction))
    {
        command.Parameters.AddWithValue("query", extraction.Query);
        command.Parameters.AddWithValue("source_url", extraction.SearchUrl);
        command.Parameters.AddWithValue("prospect_count", extraction.Rows.Count);
        searchRunId = (long) (await command.ExecuteScalarAsync() ?? 0L);
    }

    foreach (var row in extraction.Rows.Where(row => !string.IsNullOrWhiteSpace(row.ProspectId)))
    {
        var payload = JsonSerializer.Serialize(row, JsonDefaults.Options);
        long rawRecordId;

        await using (var command = new NpgsqlCommand("""
            insert into paymentsense_raw.extracted_records (
              search_run_id,
              record_type,
              external_id,
              source_url,
              raw_payload
            )
            values (
              @search_run_id,
              'prospect',
              @external_id,
              @source_url,
              @raw_payload::jsonb
            )
            returning id
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("search_run_id", searchRunId);
            command.Parameters.AddWithValue("external_id", row.ProspectId!);
            command.Parameters.AddWithValue("source_url", (object?) (row.SourceUrl ?? extraction.SearchUrl) ?? DBNull.Value);
            command.Parameters.AddWithValue("raw_payload", payload);
            rawRecordId = (long) (await command.ExecuteScalarAsync() ?? 0L);
        }

        var organisationName = row.BusinessName ?? row.ContactName ?? row.ProspectId ?? "Unknown prospect";
        var normalizedName = TextNormalizer.NormalizeOrganisationName(organisationName);
        if (string.IsNullOrWhiteSpace(normalizedName))
        {
            normalizedName = TextNormalizer.NormalizeOrganisationName(row.ProspectId ?? organisationName);
        }

        long organisationId;
        await using (var command = new NpgsqlCommand("""
            insert into paymentsense_core.organisations (display_name, normalized_name, source_confidence)
            values (@display_name, @normalized_name, 0.8500)
            on conflict do nothing
            returning id
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("display_name", organisationName);
            command.Parameters.AddWithValue("normalized_name", normalizedName);
            var result = await command.ExecuteScalarAsync();
            if (result is long id)
            {
                organisationId = id;
            }
            else
            {
                await using var lookup = new NpgsqlCommand("""
                    select id
                    from paymentsense_core.organisations
                    where normalized_name = @normalized_name
                    order by id
                    limit 1
                    """, connection, transaction);
                lookup.Parameters.AddWithValue("normalized_name", normalizedName);
                organisationId = (long) (await lookup.ExecuteScalarAsync() ?? throw new InvalidOperationException("Organisation lookup failed."));
            }
        }

        await using (var command = new NpgsqlCommand("""
            insert into paymentsense_core.prospects (
              organisation_id,
              prospect_id,
              created_on,
              owner_name,
              sales_url,
              raw_record_id
            )
            values (
              @organisation_id,
              @prospect_id,
              @created_on,
              @owner_name,
              @sales_url,
              @raw_record_id
            )
            on conflict (prospect_id) do update set
              organisation_id = excluded.organisation_id,
              created_on = excluded.created_on,
              owner_name = excluded.owner_name,
              sales_url = excluded.sales_url,
              raw_record_id = excluded.raw_record_id,
              updated_at = now()
            returning id
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("organisation_id", organisationId);
            command.Parameters.AddWithValue("prospect_id", row.ProspectId!);
            command.Parameters.AddWithValue("created_on", (object?) TextNormalizer.TryParseUkDate(row.CreatedOn) ?? DBNull.Value);
            command.Parameters.AddWithValue("owner_name", (object?) row.OwnerName ?? DBNull.Value);
            command.Parameters.AddWithValue("sales_url", $"https://sales.paymentsense.com/prospect/{Uri.EscapeDataString(row.ProspectId!)}");
            command.Parameters.AddWithValue("raw_record_id", rawRecordId);
            await command.ExecuteScalarAsync();
        }

        if (!string.IsNullOrWhiteSpace(row.ContactName) || !string.IsNullOrWhiteSpace(row.ContactEmail))
        {
            await using var contactCommand = new NpgsqlCommand("""
                insert into paymentsense_core.contacts (
                  organisation_id,
                  full_name,
                  normalized_name,
                  email,
                  normalized_email,
                  source_confidence
                )
                select
                  @organisation_id,
                  @full_name,
                  @normalized_name,
                  @email,
                  @normalized_email,
                  0.8500
                where not exists (
                  select 1
                  from paymentsense_core.contacts
                  where organisation_id = @organisation_id
                    and coalesce(normalized_email, '') = coalesce(@normalized_email, '')
                    and coalesce(normalized_name, '') = coalesce(@normalized_name, '')
                )
                """, connection, transaction);
            contactCommand.Parameters.AddWithValue("organisation_id", organisationId);
            contactCommand.Parameters.AddWithValue("full_name", (object?) row.ContactName ?? DBNull.Value);
            contactCommand.Parameters.AddWithValue("normalized_name", (object?) TextNormalizer.NormalizePersonName(row.ContactName) ?? DBNull.Value);
            contactCommand.Parameters.AddWithValue("email", (object?) row.ContactEmail ?? DBNull.Value);
            contactCommand.Parameters.AddWithValue("normalized_email", (object?) TextNormalizer.NormalizeEmail(row.ContactEmail) ?? DBNull.Value);
            await contactCommand.ExecuteNonQueryAsync();
        }
    }

    await transaction.CommitAsync();
}

static async Task SaveProspectSearchCacheAsync(NpgsqlDataSource db, LiveProspectExtraction extraction)
{
    await CleanupExpiredProspectSearchCacheAsync(db);

    var rowsJson = JsonSerializer.Serialize(
        extraction.Rows.Select(row => new ProspectSearchRowResponse(
            row.ProspectId ?? "",
            row.BusinessName ?? "",
            row.ContactName,
            row.ContactEmail,
            TextNormalizer.TryParseUkDate(row.CreatedOn),
            row.OwnerName,
            row.SourceUrl,
            null,
            false,
            false)).ToList(),
        JsonDefaults.Options);

    await using var command = db.CreateCommand("""
        insert into paymentsense_raw.prospect_search_cache (
          query_text,
          normalized_query,
          search_url,
          rows_json,
          expires_at
        )
        values (
          @query_text,
          @normalized_query,
          @search_url,
          @rows_json::jsonb,
          now() + interval '7 days'
        )
        on conflict (normalized_query) do update
        set query_text = excluded.query_text,
            search_url = excluded.search_url,
            rows_json = excluded.rows_json,
            created_at = now(),
            expires_at = excluded.expires_at
        """);
    command.Parameters.AddWithValue("query_text", extraction.Query);
    command.Parameters.AddWithValue("normalized_query", (extraction.Query ?? string.Empty).Trim().ToLowerInvariant());
    command.Parameters.AddWithValue("search_url", extraction.SearchUrl);
    command.Parameters.AddWithValue("rows_json", rowsJson);
    await command.ExecuteNonQueryAsync();
}

static async Task SaveOwnedChecklistAsync(NpgsqlDataSource db, IReadOnlyCollection<LiveProspectRow> rows)
{
    await CleanupExpiredOwnedChecklistAsync(db);

    var ownedRows = rows
        .Where(row =>
            !string.IsNullOrWhiteSpace(row.OwnerName) &&
            !string.IsNullOrWhiteSpace(row.BusinessName))
        .ToList();

    if (ownedRows.Count == 0)
    {
        return;
    }

    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    foreach (var row in ownedRows)
    {
        var normalizedBusinessName = TextNormalizer.NormalizeOrganisationName(row.BusinessName!);
        var normalizedContactName = TextNormalizer.NormalizePersonName(row.ContactName);
        var normalizedContactEmail = TextNormalizer.NormalizeEmail(row.ContactEmail);

        await using var command = new NpgsqlCommand("""
            insert into paymentsense_core.owned_checklist (
              business_name,
              normalized_business_name,
              contact_name,
              normalized_contact_name,
              contact_email,
              normalized_contact_email,
              owner_name,
              expires_at
            )
            values (
              @business_name,
              @normalized_business_name,
              @contact_name,
              @normalized_contact_name,
              @contact_email,
              @normalized_contact_email,
              @owner_name,
              now() + interval '60 days'
            )
            """, connection, transaction);
        command.Parameters.AddWithValue("business_name", row.BusinessName!);
        command.Parameters.AddWithValue("normalized_business_name", normalizedBusinessName);
        command.Parameters.AddWithValue("contact_name", (object?)row.ContactName ?? DBNull.Value);
        command.Parameters.AddWithValue("normalized_contact_name", (object?)normalizedContactName ?? DBNull.Value);
        command.Parameters.AddWithValue("contact_email", (object?)row.ContactEmail ?? DBNull.Value);
        command.Parameters.AddWithValue("normalized_contact_email", (object?)normalizedContactEmail ?? DBNull.Value);
        command.Parameters.AddWithValue("owner_name", row.OwnerName!);
        await command.ExecuteNonQueryAsync();
    }

    await transaction.CommitAsync();
}

static async Task<ProspectSearchPreviewResponse?> LoadCachedProspectSearchAsync(NpgsqlDataSource db, string query)
{
    var normalizedQuery = (query ?? string.Empty).Trim().ToLowerInvariant();
    if (string.IsNullOrWhiteSpace(normalizedQuery))
    {
        return null;
    }

    await CleanupExpiredProspectSearchCacheAsync(db);

    await using var command = db.CreateCommand("""
        select query_text, search_url, rows_json::text, created_at, expires_at
        from paymentsense_raw.prospect_search_cache
        where normalized_query = @normalized_query
          and expires_at > now()
        limit 1
        """);
    command.Parameters.AddWithValue("normalized_query", normalizedQuery);

    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    var cachedQuery = reader.GetString(0);
    var searchUrl = reader.GetString(1);
    var rowsJson = reader.GetString(2);
    var createdAt = reader.GetDateTime(3);
    var expiresAt = reader.GetDateTime(4);
    var cachedRows = JsonSerializer.Deserialize<List<ProspectSearchRowResponse>>(rowsJson, JsonDefaults.Options) ?? [];

    var prospectIds = cachedRows
        .Select(row => row.ProspectId)
        .Where(id => !string.IsNullOrWhiteSpace(id))
        .ToArray();
    var detailFlags = await LoadProspectStoredDetailFlagsAsync(db, prospectIds);
    var postcodes = await LoadProspectPostcodesByRefAsync(db, prospectIds);
    var storedProspectIds = await LoadStoredProspectIdsAsync(db, prospectIds);

    var rows = cachedRows
        .Select(row => row with
        {
            Postcode = postcodes.TryGetValue(row.ProspectId, out var postcode) ? postcode : row.Postcode,
            HasStoredDetail = detailFlags.Contains(row.ProspectId),
            Added = storedProspectIds.Contains(row.ProspectId)
        })
        .ToList();

    return new ProspectSearchPreviewResponse(
        cachedQuery,
        searchUrl,
        rows,
        true,
        createdAt,
        expiresAt);
}

static async Task CleanupExpiredProspectSearchCacheAsync(NpgsqlDataSource db)
{
    await using var command = db.CreateCommand("""
        delete from paymentsense_raw.prospect_search_cache
        where expires_at <= now()
        """);
    await command.ExecuteNonQueryAsync();
}

static async Task CleanupExpiredOwnedChecklistAsync(NpgsqlDataSource db)
{
    await using var command = db.CreateCommand("""
        delete from paymentsense_core.owned_checklist
        where expires_at <= now()
        """);
    await command.ExecuteNonQueryAsync();
}

static async Task<List<OwnedChecklistMatchResponse>> LoadOwnedChecklistMatchesAsync(NpgsqlDataSource db, long customerId)
{
    const string sql = """
        with customer_scope as (
          select
            c.id,
            o.id as organisation_id,
            o.normalized_name as normalized_entity_name,
            c.normalized_trading_name
          from paymentsense_core.customers c
          join paymentsense_core.organisations o on o.id = c.organisation_id
          where c.id = @customer_id
        )
        select
          oc.id,
          oc.business_name,
          oc.contact_name,
          oc.contact_email,
          oc.owner_name,
          oc.created_at,
          oc.expires_at,
          case
            when oc.normalized_contact_email is not null and exists (
              select 1
              from paymentsense_core.contacts ct
              join customer_scope cs on cs.organisation_id = ct.organisation_id
              where ct.normalized_email = oc.normalized_contact_email
            ) then 'Matched contact email'
            when oc.normalized_business_name is not null and exists (
              select 1
              from customer_scope cs
              where char_length(oc.normalized_business_name) >= 6
                and (
                  oc.normalized_business_name = cs.normalized_entity_name
                  or oc.normalized_business_name = cs.normalized_trading_name
                  or cs.normalized_entity_name like '%' || oc.normalized_business_name || '%'
                  or oc.normalized_business_name like '%' || cs.normalized_entity_name || '%'
                  or (
                    cs.normalized_trading_name is not null
                    and (
                      cs.normalized_trading_name like '%' || oc.normalized_business_name || '%'
                      or oc.normalized_business_name like '%' || cs.normalized_trading_name || '%'
                    )
                  )
                )
            ) then 'Matched business name'
            when oc.normalized_contact_name is not null and exists (
              select 1
              from paymentsense_core.contacts ct
              join customer_scope cs on cs.organisation_id = ct.organisation_id
              where char_length(oc.normalized_contact_name) >= 6
                and ct.normalized_name is not null
                and (
                  ct.normalized_name = oc.normalized_contact_name
                  or ct.normalized_name like '%' || oc.normalized_contact_name || '%'
                  or oc.normalized_contact_name like '%' || ct.normalized_name || '%'
                )
            ) then 'Matched contact name'
            else 'Possible fuzzy match'
          end as reason
        from paymentsense_core.owned_checklist oc
        where oc.expires_at > now()
          and (
            (
              oc.normalized_contact_email is not null
              and exists (
                select 1
                from paymentsense_core.contacts ct
                join customer_scope cs on cs.organisation_id = ct.organisation_id
                where ct.normalized_email = oc.normalized_contact_email
              )
            )
            or (
              oc.normalized_business_name is not null
              and exists (
                select 1
                from customer_scope cs
                where char_length(oc.normalized_business_name) >= 6
                  and (
                    oc.normalized_business_name = cs.normalized_entity_name
                    or oc.normalized_business_name = cs.normalized_trading_name
                    or cs.normalized_entity_name like '%' || oc.normalized_business_name || '%'
                    or oc.normalized_business_name like '%' || cs.normalized_entity_name || '%'
                    or (
                      cs.normalized_trading_name is not null
                      and (
                        cs.normalized_trading_name like '%' || oc.normalized_business_name || '%'
                        or oc.normalized_business_name like '%' || cs.normalized_trading_name || '%'
                      )
                    )
                  )
              )
            )
            or (
              oc.normalized_contact_name is not null
              and exists (
                select 1
                from paymentsense_core.contacts ct
                join customer_scope cs on cs.organisation_id = ct.organisation_id
                where char_length(oc.normalized_contact_name) >= 6
                  and ct.normalized_name is not null
                  and (
                    ct.normalized_name = oc.normalized_contact_name
                    or ct.normalized_name like '%' || oc.normalized_contact_name || '%'
                    or oc.normalized_contact_name like '%' || ct.normalized_name || '%'
                  )
              )
            )
          )
        order by oc.created_at desc, oc.id desc
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("customer_id", customerId);

    var rows = new List<OwnedChecklistMatchResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new OwnedChecklistMatchResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetNullableString(2),
            reader.GetNullableString(3),
            reader.GetString(4),
            reader.GetDateTime(5),
            reader.GetDateTime(6),
            reader.GetString(7)));
    }

    return rows;
}

static async Task<HashSet<string>> LoadProspectStoredDetailFlagsAsync(NpgsqlDataSource db, IReadOnlyCollection<string> prospectIds)
{
    var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    if (prospectIds.Count == 0)
    {
        return result;
    }

    const string sql = """
        select distinct r.external_id
        from paymentsense_raw.extracted_records r
        where r.record_type = 'prospect_detail'
          and r.raw_payload->>'extractorVersion' = '2'
          and r.external_id = any(@prospect_ids)
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("prospect_ids", prospectIds.ToArray());
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        result.Add(reader.GetString(0));
    }

    return result;
}

static async Task<HashSet<string>> LoadStoredCustomerKeysAsync(NpgsqlDataSource db, IReadOnlyCollection<string> keys)
{
    var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    if (keys.Count == 0)
    {
        return result;
    }

    const string sql = """
        select distinct value
        from (
          select mid as value from paymentsense_core.customers where mid = any(@keys)
          union all
          select customer_ref as value from paymentsense_core.customers where customer_ref = any(@keys)
        ) matches
        where value is not null
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("keys", keys.ToArray());
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        result.Add(reader.GetString(0));
    }

    return result;
}

static async Task<HashSet<string>> LoadStoredProspectIdsAsync(NpgsqlDataSource db, IReadOnlyCollection<string> prospectIds)
{
    var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    if (prospectIds.Count == 0)
    {
        return result;
    }

    const string sql = """
        select prospect_id
        from paymentsense_core.prospects
        where prospect_id = any(@prospect_ids)
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("prospect_ids", prospectIds.ToArray());
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        result.Add(reader.GetString(0));
    }

    return result;
}

static async Task<CustomerMatchSource?> LoadCustomerMatchSourceAsync(NpgsqlDataSource db, long customerId)
{
    const string sql = """
        select
          c.id,
          c.organisation_id,
          o.display_name,
          o.normalized_name,
          c.trading_name,
          c.normalized_trading_name,
          a.line1,
          a.normalized_postcode,
          c.suppression_reason
        from paymentsense_core.customers c
        join paymentsense_core.organisations o on o.id = c.organisation_id
        left join lateral (
          select line1, normalized_postcode
          from paymentsense_core.addresses
          where organisation_id = o.id
          order by id
          limit 1
        ) a on true
        where c.id = @customer_id
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("customer_id", customerId);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    return new CustomerMatchSource(
        reader.GetInt64(0),
        reader.GetInt64(1),
        reader.GetString(2),
        reader.GetNullableString(3),
        reader.GetNullableString(4),
        reader.GetNullableString(5),
        reader.GetNullableString(6),
        reader.GetNullableString(7),
        reader.GetNullableString(8));
}

static async Task<bool> CustomerExistsAsync(NpgsqlDataSource db, long customerId)
{
    await using var command = db.CreateCommand("""
        select exists(
          select 1
          from paymentsense_core.customers
          where id = @customer_id
        )
        """);
    command.Parameters.AddWithValue("customer_id", customerId);
    return (bool?) await command.ExecuteScalarAsync() ?? false;
}

static async Task<IReadOnlyList<CustomerNoteResponse>> LoadCustomerNotesAsync(NpgsqlDataSource db, long customerId)
{
    const string sql = """
        select
          n.id,
          n.note_text,
          n.created_at,
          n.created_by_user_id,
          u.full_name
        from paymentsense_core.customer_notes n
        left join paymentsense_core.users u on u.id = n.created_by_user_id
        where n.customer_id = @customer_id
        order by n.created_at desc, n.id desc
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("customer_id", customerId);
    var notes = new List<CustomerNoteResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        notes.Add(new CustomerNoteResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetDateTime(2),
            reader.IsDBNull(3) ? null : reader.GetInt64(3),
            reader.GetNullableString(4)));
    }

    return notes;
}

static async Task<CustomerCommercialsResponse?> LoadCustomerCommercialsAsync(NpgsqlDataSource db, long customerId)
{
    await using var command = db.CreateCommand("""
        select
          cc.credit_card_value,
          cc.value_period,
          cc.current_charge_percent,
          cc.proposed_charge_percent,
          c.customer_value_type_id,
          cvt.label,
          cvt.decimal_value,
          cvt.shield_order,
          cvt.image_file_name
        from paymentsense_core.customers c
        left join paymentsense_core.customer_commercials cc on cc.customer_id = c.id
        left join paymentsense_core.customer_value_types cvt on cvt.id = c.customer_value_type_id
        where c.id = @customer_id
        """);
    command.Parameters.AddWithValue("customer_id", customerId);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    decimal? creditCardValue = reader.IsDBNull(0) ? null : reader.GetDecimal(0);
    var valuePeriod = reader.GetNullableString(1);
    decimal? currentChargePercent = reader.IsDBNull(2) ? null : reader.GetDecimal(2);
    decimal? proposedChargePercent = reader.IsDBNull(3) ? null : reader.GetDecimal(3);
    long? customerValueTypeId = reader.IsDBNull(4) ? null : reader.GetInt64(4);
    var customerValueTypeLabel = reader.GetNullableString(5);
    decimal? customerValueTypeDecimalValue = reader.IsDBNull(6) ? null : reader.GetDecimal(6);
    int? customerValueTypeShieldOrder = reader.IsDBNull(7) ? null : reader.GetInt32(7);
    var customerValueTypeImageFileName = reader.GetNullableString(8);
    decimal? currentChargeAmount = null;
    decimal? proposedChargeAmount = null;
    decimal? differenceAmount = null;

    if (creditCardValue.HasValue && currentChargePercent.HasValue)
    {
        currentChargeAmount = decimal.Round(creditCardValue.Value * (currentChargePercent.Value / 100m), 2);
    }

    if (creditCardValue.HasValue && proposedChargePercent.HasValue)
    {
        proposedChargeAmount = decimal.Round(creditCardValue.Value * (proposedChargePercent.Value / 100m), 2);
    }

    if (currentChargeAmount.HasValue && proposedChargeAmount.HasValue)
    {
        differenceAmount = decimal.Round(currentChargeAmount.Value - proposedChargeAmount.Value, 2);
    }

    return new CustomerCommercialsResponse(
        creditCardValue,
        valuePeriod,
        currentChargePercent,
        proposedChargePercent,
        currentChargeAmount,
        proposedChargeAmount,
        differenceAmount,
        customerValueTypeId,
        customerValueTypeLabel,
        customerValueTypeDecimalValue,
        customerValueTypeShieldOrder,
        customerValueTypeImageFileName);
}

static async Task<IReadOnlyList<CustomerProspectMatchResponse>> LoadCustomerMatchesAsync(NpgsqlDataSource db, long customerId, bool generatedNow)
{
    const string sql = """
        with related_matches as (
          select
            m.id as match_id,
            m.prospect_id,
            m.score,
            m.match_status,
            m.reasons,
            m.generated_at
          from paymentsense_core.match_candidates m
          where m.customer_id = @customer_id

          union all

          select
            coalesce(m.id, lp.match_candidate_id, 0) as match_id,
            lp.prospect_id,
            coalesce(m.score, 1.0) as score,
            coalesce(m.match_status, 'confirmed') as match_status,
            coalesce(m.reasons, '["attached to lead"]'::jsonb) as reasons,
            coalesce(m.generated_at, l.created_at) as generated_at
          from paymentsense_core.leads l
          join paymentsense_core.lead_prospects lp on lp.lead_id = l.id
          left join paymentsense_core.match_candidates m on m.id = lp.match_candidate_id
          where l.customer_id = @customer_id
            and not exists (
              select 1
              from paymentsense_core.match_candidates existing
              where existing.customer_id = @customer_id
                and existing.prospect_id = lp.prospect_id
            )
        )
        select
          rm.match_id,
          p.prospect_id,
          po.display_name,
          pc.full_name,
          pc.email,
          p.owner_name,
          pa.line1,
          pa.normalized_postcode,
          rm.score,
          rm.match_status,
          rm.reasons::text,
          exists (
            select 1
            from paymentsense_raw.extracted_records r
            where r.record_type = 'prospect_detail'
              and r.external_id = p.prospect_id
              and r.raw_payload->>'extractorVersion' = '2'
          ) as has_stored_detail
        from related_matches rm
        join paymentsense_core.prospects p on p.id = rm.prospect_id
        join paymentsense_core.organisations po on po.id = p.organisation_id
        left join lateral (
          select full_name, email
          from paymentsense_core.contacts
          where organisation_id = po.id
          order by id
          limit 1
        ) pc on true
        left join lateral (
          select line1, normalized_postcode
          from paymentsense_core.addresses
          where organisation_id = po.id
          order by id
          limit 1
        ) pa on true
        order by rm.score desc, rm.generated_at desc, p.prospect_id
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("customer_id", customerId);

    var rows = new List<CustomerProspectMatchResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new CustomerProspectMatchResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetNullableString(3),
            reader.GetNullableString(4),
            reader.GetNullableString(5),
            reader.GetNullableString(6),
            reader.GetNullableString(7),
            reader.GetDecimal(8),
            reader.GetString(9),
            ParseReasons(reader.GetString(10)),
            generatedNow,
            reader.GetBoolean(11)));
    }

    return rows;
}

static async Task<Dictionary<string, string?>> LoadProspectPostcodesByRefAsync(NpgsqlDataSource db, IReadOnlyCollection<string> prospectIds)
{
    if (prospectIds.Count == 0)
    {
        return [];
    }

    const string sql = """
        select
          p.prospect_id,
          a.normalized_postcode
        from paymentsense_core.prospects p
        left join lateral (
          select normalized_postcode
          from paymentsense_core.addresses
          where organisation_id = p.organisation_id
          order by id desc
          limit 1
        ) a on true
        where p.prospect_id = any(@prospect_ids)
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("prospect_ids", prospectIds.ToArray());

    var rows = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows[reader.GetString(0)] = reader.GetNullableString(1);
    }

    return rows;
}

static async Task<LeadSummaryResponse?> LoadLeadSummaryByCustomerIdAsync(NpgsqlDataSource db, long customerId)
{
    const string sql = """
        select
          l.id,
          l.customer_id,
          l.lead_status,
          l.created_at
        from paymentsense_core.leads l
        where l.customer_id = @customer_id
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("customer_id", customerId);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    return new LeadSummaryResponse(
        reader.GetInt64(0),
        reader.GetInt64(1),
        reader.GetString(2),
        reader.GetDateTime(3));
}

static async Task<long?> LoadProspectDbIdByReferenceAsync(NpgsqlDataSource db, string prospectId)
{
    await using var command = db.CreateCommand("""
        select id
        from paymentsense_core.prospects
        where prospect_id = @prospect_id
        order by id desc
        limit 1
        """);
    command.Parameters.AddWithValue("prospect_id", prospectId);
    var result = await command.ExecuteScalarAsync();
    return result is long id ? id : null;
}

static async Task<LeadSummaryResponse?> CreateLeadFromCustomerAsync(NpgsqlDataSource db, long customerId, long? assignedUserId = null)
{
    var existingLead = await LoadLeadSummaryByCustomerIdAsync(db, customerId);
    if (existingLead is not null)
    {
        return existingLead;
    }

    const string sql = """
        with matched_prospects as (
          select
            m.prospect_id,
            row_number() over (order by m.score desc, m.generated_at desc, m.id desc) as prospect_rank
          from paymentsense_core.match_candidates m
          where m.customer_id = @customer_id
        ),
        inserted_lead as (
          insert into paymentsense_core.leads (customer_id, lead_status, assigned_user_id, primary_prospect_id)
          select
            @customer_id,
            'open',
            @assigned_user_id,
            (
              select prospect_id
              from matched_prospects
              where prospect_rank = 1
            )
          where exists (select 1 from matched_prospects)
          on conflict (customer_id) do update set
            updated_at = now()
          returning id, customer_id, lead_status, created_at
        ),
        inserted_links as (
          insert into paymentsense_core.lead_prospects (lead_id, prospect_id, match_candidate_id, is_primary)
          select
            l.id,
            m.prospect_id,
            m.id,
            mp.prospect_rank = 1
          from inserted_lead l
          join paymentsense_core.match_candidates m on m.customer_id = l.customer_id
          join matched_prospects mp on mp.prospect_id = m.prospect_id
          on conflict (lead_id, prospect_id) do update set
            match_candidate_id = excluded.match_candidate_id,
            is_primary = excluded.is_primary
        )
        select id, customer_id, lead_status, created_at
        from inserted_lead
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("customer_id", customerId);
    command.Parameters.AddWithValue("assigned_user_id", (object?)assignedUserId ?? DBNull.Value);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    return new LeadSummaryResponse(
        reader.GetInt64(0),
        reader.GetInt64(1),
        reader.GetString(2),
        reader.GetDateTime(3));
}

static async Task<bool> RemoveCustomerMatchAsync(NpgsqlDataSource db, long customerId, long matchId)
{
    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    long? prospectDbId = null;
    await using (var lookup = new NpgsqlCommand("""
        select prospect_id
        from paymentsense_core.match_candidates
        where id = @match_id and customer_id = @customer_id
        """, connection, transaction))
    {
        lookup.Parameters.AddWithValue("match_id", matchId);
        lookup.Parameters.AddWithValue("customer_id", customerId);
        var scalar = await lookup.ExecuteScalarAsync();
        if (scalar is null)
        {
            return false;
        }

        prospectDbId = (long) scalar;
    }

    await using (var detachLeadProspect = new NpgsqlCommand("""
        delete from paymentsense_core.lead_prospects
        where lead_id in (
          select id from paymentsense_core.leads where customer_id = @customer_id
        )
        and prospect_id = @prospect_id
        """, connection, transaction))
    {
        detachLeadProspect.Parameters.AddWithValue("customer_id", customerId);
        detachLeadProspect.Parameters.AddWithValue("prospect_id", prospectDbId!.Value);
        await detachLeadProspect.ExecuteNonQueryAsync();
    }

    await using (var deleteMatch = new NpgsqlCommand("""
        delete from paymentsense_core.match_candidates
        where id = @match_id and customer_id = @customer_id
        """, connection, transaction))
    {
        deleteMatch.Parameters.AddWithValue("match_id", matchId);
        deleteMatch.Parameters.AddWithValue("customer_id", customerId);
        await deleteMatch.ExecuteNonQueryAsync();
    }

    await using (var promotePrimary = new NpgsqlCommand("""
        with next_primary as (
          select lp.lead_id, lp.prospect_id
          from paymentsense_core.lead_prospects lp
          join paymentsense_core.leads l on l.id = lp.lead_id
          where l.customer_id = @customer_id
          order by lp.is_primary desc, lp.created_at asc, lp.prospect_id
          limit 1
        )
        update paymentsense_core.leads l
        set primary_prospect_id = np.prospect_id,
            updated_at = now()
        from next_primary np
        where l.id = np.lead_id
        """, connection, transaction))
    {
        promotePrimary.Parameters.AddWithValue("customer_id", customerId);
        await promotePrimary.ExecuteNonQueryAsync();
    }

    await using (var clearEmptyPrimary = new NpgsqlCommand("""
        update paymentsense_core.leads l
        set primary_prospect_id = null,
            updated_at = now()
        where l.customer_id = @customer_id
          and not exists (
            select 1
            from paymentsense_core.lead_prospects lp
            where lp.lead_id = l.id
          )
        """, connection, transaction))
    {
        clearEmptyPrimary.Parameters.AddWithValue("customer_id", customerId);
        await clearEmptyPrimary.ExecuteNonQueryAsync();
    }

    await transaction.CommitAsync();
    return true;
}

static async Task<bool> RemoveLeadAsync(NpgsqlDataSource db, long leadId)
{
    await using var command = db.CreateCommand("""
        delete from paymentsense_core.leads
        where id = @lead_id
        """);
    command.Parameters.AddWithValue("lead_id", leadId);
    var affected = await command.ExecuteNonQueryAsync();
    return affected > 0;
}

static async Task<ArchiveOperationResult> ArchiveCustomerAsync(NpgsqlDataSource db, long customerId)
{
    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    var customerSnapshot = await LoadCustomerArchiveSnapshotAsync(connection, transaction, customerId);
    if (customerSnapshot is null)
    {
        return ArchiveOperationResult.NotFound("Customer not found.");
    }

    await using (var leadCheck = new NpgsqlCommand("""
        select exists (
          select 1
          from paymentsense_core.leads
          where customer_id = @customer_id
        )
        """, connection, transaction))
    {
        leadCheck.Parameters.AddWithValue("customer_id", customerId);
        if ((bool?) await leadCheck.ExecuteScalarAsync() == true)
        {
            return ArchiveOperationResult.Blocked("This customer already has a lead and cannot be archived.");
        }
    }

    await InsertArchivedCustomerSnapshotAsync(connection, transaction, customerSnapshot);

    await using (var deleteCustomer = new NpgsqlCommand("""
        delete from paymentsense_core.customers
        where id = @customer_id
        """, connection, transaction))
    {
        deleteCustomer.Parameters.AddWithValue("customer_id", customerId);
        await deleteCustomer.ExecuteNonQueryAsync();
    }

    await CleanupOrphanOrganisationAsync(connection, transaction, customerSnapshot.SourceOrganisationId);
    await transaction.CommitAsync();
    return ArchiveOperationResult.Success();
}

static async Task<ArchiveOperationResult> RemoveImportedCustomerAsync(NpgsqlDataSource db, CustomerSearchRowInsertRequest request)
{
    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    long? customerId = null;
    long? organisationId = null;

    await using (var lookup = new NpgsqlCommand("""
        select c.id, c.organisation_id
        from paymentsense_core.customers c
        join paymentsense_core.organisations o on o.id = c.organisation_id
        where (
            (@mid <> '' and c.mid = @mid)
            or (@mid = '' and @customer_ref <> '' and c.customer_ref = @customer_ref)
          )
          and lower(o.display_name) = lower(@entity_name)
        order by c.updated_at desc, c.id desc
        limit 1
        """, connection, transaction))
    {
        lookup.Parameters.AddWithValue("mid", request.Mid?.Trim() ?? "");
        lookup.Parameters.AddWithValue("customer_ref", request.CustomerRef?.Trim() ?? "");
        lookup.Parameters.AddWithValue("entity_name", request.Entity?.Trim() ?? "");

        await using var reader = await lookup.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return ArchiveOperationResult.NotFound("Customer not found in the database.");
        }

        customerId = reader.GetInt64(0);
        organisationId = reader.GetInt64(1);
    }

    await using (var leadCheck = new NpgsqlCommand("""
        select exists (
          select 1
          from paymentsense_core.leads
          where customer_id = @customer_id
        )
        """, connection, transaction))
    {
        leadCheck.Parameters.AddWithValue("customer_id", customerId!.Value);
        if ((bool?) await leadCheck.ExecuteScalarAsync() == true)
        {
            return ArchiveOperationResult.Blocked("This customer is already a lead and cannot be removed.");
        }
    }

    await using (var deleteCustomer = new NpgsqlCommand("""
        delete from paymentsense_core.customers
        where id = @customer_id
        """, connection, transaction))
    {
        deleteCustomer.Parameters.AddWithValue("customer_id", customerId!.Value);
        await deleteCustomer.ExecuteNonQueryAsync();
    }

    await CleanupOrphanOrganisationAsync(connection, transaction, organisationId!.Value);
    await transaction.CommitAsync();
    return ArchiveOperationResult.Success();
}

static async Task<ArchiveOperationResult> RemoveImportedProspectAsync(NpgsqlDataSource db, ProspectSearchRowInsertRequest request)
{
    if (string.IsNullOrWhiteSpace(request.ProspectId))
    {
        return ArchiveOperationResult.NotFound("Prospect not found in the database.");
    }

    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    long? prospectDbId = null;
    long? organisationId = null;

    await using (var lookup = new NpgsqlCommand("""
        select id, organisation_id
        from paymentsense_core.prospects
        where prospect_id = @prospect_id
        order by updated_at desc, id desc
        limit 1
        """, connection, transaction))
    {
        lookup.Parameters.AddWithValue("prospect_id", request.ProspectId.Trim());
        await using var reader = await lookup.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return ArchiveOperationResult.NotFound("Prospect not found in the database.");
        }

        prospectDbId = reader.GetInt64(0);
        organisationId = reader.GetInt64(1);
    }

    await using (var leadCheck = new NpgsqlCommand("""
        select exists (
          select 1
          from paymentsense_core.lead_prospects
          where prospect_id = @prospect_id
        ) or exists (
          select 1
          from paymentsense_core.leads
          where primary_prospect_id = @prospect_id
        )
        """, connection, transaction))
    {
        leadCheck.Parameters.AddWithValue("prospect_id", prospectDbId!.Value);
        if ((bool?) await leadCheck.ExecuteScalarAsync() == true)
        {
            return ArchiveOperationResult.Blocked("This prospect is already on a lead and cannot be removed.");
        }
    }

    await using (var deleteProspect = new NpgsqlCommand("""
        delete from paymentsense_core.prospects
        where id = @prospect_id
        """, connection, transaction))
    {
        deleteProspect.Parameters.AddWithValue("prospect_id", prospectDbId!.Value);
        await deleteProspect.ExecuteNonQueryAsync();
    }

    await CleanupOrphanOrganisationAsync(connection, transaction, organisationId!.Value);
    await transaction.CommitAsync();
    return ArchiveOperationResult.Success();
}

static async Task<ArchiveOperationResult> ArchiveProspectAsync(NpgsqlDataSource db, long prospectDbId)
{
    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    var prospectSnapshot = await LoadProspectArchiveSnapshotAsync(connection, transaction, prospectDbId);
    if (prospectSnapshot is null)
    {
        return ArchiveOperationResult.NotFound("Prospect not found.");
    }

    await using (var leadCheck = new NpgsqlCommand("""
        select exists (
          select 1
          from paymentsense_core.lead_prospects
          where prospect_id = @prospect_id
        )
        or exists (
          select 1
          from paymentsense_core.leads
          where primary_prospect_id = @prospect_id
        )
        """, connection, transaction))
    {
        leadCheck.Parameters.AddWithValue("prospect_id", prospectDbId);
        if ((bool?) await leadCheck.ExecuteScalarAsync() == true)
        {
            return ArchiveOperationResult.Blocked("This prospect is linked to a lead and cannot be archived.");
        }
    }

    await InsertArchivedProspectSnapshotAsync(connection, transaction, prospectSnapshot);

    await using (var deleteProspect = new NpgsqlCommand("""
        delete from paymentsense_core.prospects
        where id = @prospect_id
        """, connection, transaction))
    {
        deleteProspect.Parameters.AddWithValue("prospect_id", prospectDbId);
        await deleteProspect.ExecuteNonQueryAsync();
    }

    await CleanupOrphanOrganisationAsync(connection, transaction, prospectSnapshot.SourceOrganisationId);
    await transaction.CommitAsync();
    return ArchiveOperationResult.Success();
}

static async Task<CustomerArchiveSnapshot?> LoadCustomerArchiveSnapshotAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, long customerId)
{
    long sourceCustomerId;
    long sourceOrganisationId;
    string? customerRef;
    string? mid;
    string customerKind;
    string? entityName;
    string? tradingName;
    DateOnly? startDate;
    string? status;
    string? sourceUrl;
    long? rawRecordId;
    DateTime createdAt;
    DateTime updatedAt;

    await using var command = new NpgsqlCommand("""
        select
          c.id,
          c.organisation_id,
          c.customer_ref,
          c.mid,
          c.customer_kind,
          c.trading_name,
          c.normalized_trading_name,
          c.start_date,
          c.status,
          c.source_url,
          c.raw_record_id,
          c.created_at,
          c.updated_at,
          o.display_name,
          o.normalized_name,
          o.company_number,
          o.status,
          o.source_confidence,
          o.created_at,
          o.updated_at
        from paymentsense_core.customers c
        join paymentsense_core.organisations o on o.id = c.organisation_id
        where c.id = @customer_id
        """, connection, transaction);
    command.Parameters.AddWithValue("customer_id", customerId);

    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    sourceCustomerId = reader.GetInt64(0);
    sourceOrganisationId = reader.GetInt64(1);
    customerRef = reader.GetNullableString(2);
    mid = reader.GetNullableString(3);
    customerKind = reader.GetString(4);
    tradingName = reader.GetNullableString(5);
    startDate = reader.IsDBNull(7) ? null : reader.GetFieldValue<DateOnly>(7);
    status = TextNormalizer.NormalizeStatus(reader.GetNullableString(8));
    sourceUrl = reader.GetNullableString(9);
    rawRecordId = reader.IsDBNull(10) ? null : reader.GetInt64(10);
    createdAt = reader.GetDateTime(11);
    updatedAt = reader.GetDateTime(12);
    entityName = reader.GetNullableString(13);
    await reader.DisposeAsync();

    return new CustomerArchiveSnapshot(
        sourceCustomerId,
        sourceOrganisationId,
        customerRef,
        mid,
        customerKind,
        entityName,
        tradingName,
        await LoadOrganisationSnapshotAsync(connection, transaction, sourceOrganisationId),
        await LoadCustomerMatchArchiveSnapshotsAsync(connection, transaction, customerId),
        startDate,
        status,
        sourceUrl,
        rawRecordId,
        createdAt,
        updatedAt,
        await LoadRawRecordSnapshotAsync(connection, transaction, rawRecordId));
}

static async Task<ProspectArchiveSnapshot?> LoadProspectArchiveSnapshotAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, long prospectDbId)
{
    long sourceProspectDbId;
    long sourceOrganisationId;
    string prospectRef;
    string? businessName;
    string? channel;
    string? origin;
    DateOnly? createdOn;
    string? ownerName;
    string? salesUrl;
    bool? hasPaymentsenseCustomerMatch;
    long? rawRecordId;
    DateTime createdAt;
    DateTime updatedAt;

    await using var command = new NpgsqlCommand("""
        select
          p.id,
          p.organisation_id,
          p.prospect_id,
          p.channel,
          p.origin,
          p.created_on,
          p.owner_name,
          p.sales_url,
          p.has_paymentsense_customer_match,
          p.raw_record_id,
          p.created_at,
          p.updated_at,
          o.display_name
        from paymentsense_core.prospects p
        join paymentsense_core.organisations o on o.id = p.organisation_id
        where p.id = @prospect_id
        """, connection, transaction);
    command.Parameters.AddWithValue("prospect_id", prospectDbId);

    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    sourceProspectDbId = reader.GetInt64(0);
    sourceOrganisationId = reader.GetInt64(1);
    prospectRef = reader.GetString(2);
    channel = reader.GetNullableString(3);
    origin = reader.GetNullableString(4);
    createdOn = reader.IsDBNull(5) ? null : reader.GetFieldValue<DateOnly>(5);
    ownerName = reader.GetNullableString(6);
    salesUrl = reader.GetNullableString(7);
    hasPaymentsenseCustomerMatch = reader.IsDBNull(8) ? null : reader.GetBoolean(8);
    rawRecordId = reader.IsDBNull(9) ? null : reader.GetInt64(9);
    createdAt = reader.GetDateTime(10);
    updatedAt = reader.GetDateTime(11);
    businessName = reader.GetNullableString(12);
    await reader.DisposeAsync();

    return new ProspectArchiveSnapshot(
        sourceProspectDbId,
        sourceOrganisationId,
        prospectRef,
        businessName,
        await LoadOrganisationSnapshotAsync(connection, transaction, sourceOrganisationId),
        await LoadProspectMatchArchiveSnapshotsAsync(connection, transaction, prospectDbId),
        channel,
        origin,
        createdOn,
        ownerName,
        salesUrl,
        hasPaymentsenseCustomerMatch,
        rawRecordId,
        createdAt,
        updatedAt,
        await LoadRawRecordSnapshotAsync(connection, transaction, rawRecordId),
        await LoadLatestProspectDetailRawRecordAsync(connection, transaction, prospectRef));
}

static async Task<OrganisationArchiveSnapshot> LoadOrganisationSnapshotAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, long organisationId)
{
    await using var organisationCommand = new NpgsqlCommand("""
        select
          id,
          display_name,
          normalized_name,
          company_number,
          status,
          source_confidence,
          created_at,
          updated_at
        from paymentsense_core.organisations
        where id = @organisation_id
        """, connection, transaction);
    organisationCommand.Parameters.AddWithValue("organisation_id", organisationId);

    await using var organisationReader = await organisationCommand.ExecuteReaderAsync();
    await organisationReader.ReadAsync();
    var organisation = new OrganisationArchiveSnapshot(
        organisationReader.GetInt64(0),
        organisationReader.GetString(1),
        organisationReader.GetString(2),
        organisationReader.GetNullableString(3),
        organisationReader.GetString(4),
        organisationReader.IsDBNull(5) ? null : organisationReader.GetDecimal(5),
        organisationReader.GetDateTime(6),
        organisationReader.GetDateTime(7),
        [],
        [],
        []);
    await organisationReader.DisposeAsync();

    var addresses = new List<AddressArchiveSnapshot>();
    await using (var addressCommand = new NpgsqlCommand("""
        select id, label, line1, line2, town, county, postcode, normalized_postcode, country, source_confidence, created_at, updated_at
        from paymentsense_core.addresses
        where organisation_id = @organisation_id
        order by id
        """, connection, transaction))
    {
        addressCommand.Parameters.AddWithValue("organisation_id", organisationId);
        await using var reader = await addressCommand.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            addresses.Add(new AddressArchiveSnapshot(
                reader.GetInt64(0),
                reader.GetNullableString(1),
                reader.GetNullableString(2),
                reader.GetNullableString(3),
                reader.GetNullableString(4),
                reader.GetNullableString(5),
                reader.GetNullableString(6),
                reader.GetNullableString(7),
                reader.GetNullableString(8),
                reader.IsDBNull(9) ? null : reader.GetDecimal(9),
                reader.GetDateTime(10),
                reader.GetDateTime(11)));
        }
    }

    var contacts = new List<ContactArchiveSnapshot>();
    await using (var contactCommand = new NpgsqlCommand("""
        select id, full_name, normalized_name, email, normalized_email, phone, normalized_phone, role, source_confidence, created_at, updated_at
        from paymentsense_core.contacts
        where organisation_id = @organisation_id
        order by id
        """, connection, transaction))
    {
        contactCommand.Parameters.AddWithValue("organisation_id", organisationId);
        await using var reader = await contactCommand.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            contacts.Add(new ContactArchiveSnapshot(
                reader.GetInt64(0),
                reader.GetNullableString(1),
                reader.GetNullableString(2),
                reader.GetNullableString(3),
                reader.GetNullableString(4),
                reader.GetNullableString(5),
                reader.GetNullableString(6),
                reader.GetNullableString(7),
                reader.IsDBNull(8) ? null : reader.GetDecimal(8),
                reader.GetDateTime(9),
                reader.GetDateTime(10)));
        }
    }

    var externalReferences = new List<ExternalReferenceArchiveSnapshot>();
    await using (var referenceCommand = new NpgsqlCommand("""
        select id, source_system, reference_type, reference_value, source_url, first_seen_at, last_seen_at, raw_record_id
        from paymentsense_core.external_references
        where organisation_id = @organisation_id
        order by id
        """, connection, transaction))
    {
        referenceCommand.Parameters.AddWithValue("organisation_id", organisationId);
        await using var reader = await referenceCommand.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            externalReferences.Add(new ExternalReferenceArchiveSnapshot(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetNullableString(4),
                reader.GetDateTime(5),
                reader.GetDateTime(6),
                reader.IsDBNull(7) ? null : reader.GetInt64(7),
                null));
        }
    }

    return organisation with
    {
        Addresses = addresses,
        Contacts = contacts,
        ExternalReferences = externalReferences
    };
}

static async Task<IReadOnlyList<MatchCandidateArchiveSnapshot>> LoadCustomerMatchArchiveSnapshotsAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, long customerId)
{
    var rows = new List<MatchCandidateArchiveSnapshot>();
    await using var command = new NpgsqlCommand("""
        select
          m.id,
          p.id,
          p.prospect_id,
          po.display_name,
          m.score,
          m.match_status,
          m.reasons::text,
          m.generated_by,
          m.generated_at,
          m.reviewed_at,
          m.reviewed_by
        from paymentsense_core.match_candidates m
        left join paymentsense_core.prospects p on p.id = m.prospect_id
        left join paymentsense_core.organisations po on po.id = p.organisation_id
        where m.customer_id = @customer_id
        order by m.score desc, m.id desc
        """, connection, transaction);
    command.Parameters.AddWithValue("customer_id", customerId);
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new MatchCandidateArchiveSnapshot(
            reader.GetInt64(0),
            reader.IsDBNull(1) ? null : reader.GetInt64(1),
            reader.GetNullableString(2),
            reader.GetNullableString(3),
            reader.GetDecimal(4),
            reader.GetString(5),
            reader.GetString(6),
            reader.GetString(7),
            reader.GetDateTime(8),
            reader.IsDBNull(9) ? null : reader.GetDateTime(9),
            reader.GetNullableString(10)));
    }

    return rows;
}

static async Task<IReadOnlyList<MatchCandidateArchiveSnapshot>> LoadProspectMatchArchiveSnapshotsAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, long prospectId)
{
    var rows = new List<MatchCandidateArchiveSnapshot>();
    await using var command = new NpgsqlCommand("""
        select
          m.id,
          c.id,
          coalesce(c.customer_ref, c.mid),
          co.display_name,
          m.score,
          m.match_status,
          m.reasons::text,
          m.generated_by,
          m.generated_at,
          m.reviewed_at,
          m.reviewed_by
        from paymentsense_core.match_candidates m
        left join paymentsense_core.customers c on c.id = m.customer_id
        left join paymentsense_core.organisations co on co.id = c.organisation_id
        where m.prospect_id = @prospect_id
        order by m.score desc, m.id desc
        """, connection, transaction);
    command.Parameters.AddWithValue("prospect_id", prospectId);
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new MatchCandidateArchiveSnapshot(
            reader.GetInt64(0),
            reader.IsDBNull(1) ? null : reader.GetInt64(1),
            reader.GetNullableString(2),
            reader.GetNullableString(3),
            reader.GetDecimal(4),
            reader.GetString(5),
            reader.GetString(6),
            reader.GetString(7),
            reader.GetDateTime(8),
            reader.IsDBNull(9) ? null : reader.GetDateTime(9),
            reader.GetNullableString(10)));
    }

    return rows;
}

static async Task<RawRecordArchiveSnapshot?> LoadRawRecordSnapshotAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, long? rawRecordId)
{
    if (rawRecordId is null)
    {
        return null;
    }

    await using var command = new NpgsqlCommand("""
        select id, search_run_id, source_system, record_type, external_id, source_url, extracted_at, raw_payload::text
        from paymentsense_raw.extracted_records
        where id = @raw_record_id
        """, connection, transaction);
    command.Parameters.AddWithValue("raw_record_id", rawRecordId.Value);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    return new RawRecordArchiveSnapshot(
        reader.GetInt64(0),
        reader.IsDBNull(1) ? null : reader.GetInt64(1),
        reader.GetString(2),
        reader.GetString(3),
        reader.GetNullableString(4),
        reader.GetNullableString(5),
        reader.GetDateTime(6),
        reader.GetString(7));
}

static async Task<RawRecordArchiveSnapshot?> LoadLatestProspectDetailRawRecordAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string prospectRef)
{
    await using var command = new NpgsqlCommand("""
        select id, search_run_id, source_system, record_type, external_id, source_url, extracted_at, raw_payload::text
        from paymentsense_raw.extracted_records
        where record_type = 'prospect_detail'
          and external_id = @prospect_ref
        order by extracted_at desc, id desc
        limit 1
        """, connection, transaction);
    command.Parameters.AddWithValue("prospect_ref", prospectRef);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    return new RawRecordArchiveSnapshot(
        reader.GetInt64(0),
        reader.IsDBNull(1) ? null : reader.GetInt64(1),
        reader.GetString(2),
        reader.GetString(3),
        reader.GetNullableString(4),
        reader.GetNullableString(5),
        reader.GetDateTime(6),
        reader.GetString(7));
}

static async Task InsertArchivedCustomerSnapshotAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, CustomerArchiveSnapshot snapshot)
{
    var json = JsonSerializer.Serialize(snapshot);
    await using var command = new NpgsqlCommand("""
        insert into paymentsense_archive.archived_customers (
          source_customer_id,
          source_organisation_id,
          customer_ref,
          mid,
          customer_kind,
          entity_name,
          trading_name,
          postcode,
          archive_reason,
          snapshot
        )
        values (
          @source_customer_id,
          @source_organisation_id,
          @customer_ref,
          @mid,
          @customer_kind,
          @entity_name,
          @trading_name,
          @postcode,
          'manual_cleanse',
          @snapshot
        )
        """, connection, transaction);
    command.Parameters.AddWithValue("source_customer_id", snapshot.SourceCustomerId);
    command.Parameters.AddWithValue("source_organisation_id", snapshot.SourceOrganisationId);
    command.Parameters.AddWithValue("customer_ref", (object?) snapshot.CustomerRef ?? DBNull.Value);
    command.Parameters.AddWithValue("mid", (object?) snapshot.Mid ?? DBNull.Value);
    command.Parameters.AddWithValue("customer_kind", snapshot.CustomerKind);
    command.Parameters.AddWithValue("entity_name", (object?) snapshot.EntityName ?? DBNull.Value);
    command.Parameters.AddWithValue("trading_name", (object?) snapshot.TradingName ?? DBNull.Value);
    command.Parameters.AddWithValue("postcode", (object?) snapshot.Organisation.Addresses.FirstOrDefault()?.NormalizedPostcode ?? DBNull.Value);
    command.Parameters.Add("snapshot", NpgsqlDbType.Jsonb).Value = json;
    await command.ExecuteNonQueryAsync();
}

static async Task InsertArchivedProspectSnapshotAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, ProspectArchiveSnapshot snapshot)
{
    var json = JsonSerializer.Serialize(snapshot);
    await using var command = new NpgsqlCommand("""
        insert into paymentsense_archive.archived_prospects (
          source_prospect_id,
          source_organisation_id,
          prospect_ref,
          business_name,
          contact_email,
          postcode,
          archive_reason,
          snapshot
        )
        values (
          @source_prospect_id,
          @source_organisation_id,
          @prospect_ref,
          @business_name,
          @contact_email,
          @postcode,
          'manual_cleanse',
          @snapshot
        )
        """, connection, transaction);
    command.Parameters.AddWithValue("source_prospect_id", snapshot.SourceProspectDbId);
    command.Parameters.AddWithValue("source_organisation_id", snapshot.SourceOrganisationId);
    command.Parameters.AddWithValue("prospect_ref", snapshot.ProspectRef);
    command.Parameters.AddWithValue("business_name", (object?) snapshot.BusinessName ?? DBNull.Value);
    command.Parameters.AddWithValue("contact_email", (object?) snapshot.Organisation.Contacts.FirstOrDefault()?.Email ?? DBNull.Value);
    command.Parameters.AddWithValue("postcode", (object?) snapshot.Organisation.Addresses.FirstOrDefault()?.NormalizedPostcode ?? DBNull.Value);
    command.Parameters.Add("snapshot", NpgsqlDbType.Jsonb).Value = json;
    await command.ExecuteNonQueryAsync();
}

static async Task CleanupOrphanOrganisationAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, long organisationId)
{
    await using var stillUsedCommand = new NpgsqlCommand("""
        select exists (
          select 1 from paymentsense_core.customers where organisation_id = @organisation_id
        ) or exists (
          select 1 from paymentsense_core.prospects where organisation_id = @organisation_id
        )
        """, connection, transaction);
    stillUsedCommand.Parameters.AddWithValue("organisation_id", organisationId);
    if ((bool?) await stillUsedCommand.ExecuteScalarAsync() == true)
    {
        return;
    }

    await using var deleteOrganisation = new NpgsqlCommand("""
        delete from paymentsense_core.organisations
        where id = @organisation_id
        """, connection, transaction);
    deleteOrganisation.Parameters.AddWithValue("organisation_id", organisationId);
    await deleteOrganisation.ExecuteNonQueryAsync();
}

static async Task<IReadOnlyList<LeadResponse>> LoadLeadsAsync(NpgsqlDataSource db, string? searchText, string? status, long? assignedUserId = null)
{
    var normalizedSearch = searchText?.Trim().ToLowerInvariant() ?? "";
    var statusFilter = string.IsNullOrWhiteSpace(status) || string.Equals(status, "all", StringComparison.OrdinalIgnoreCase)
        ? ""
        : status.Trim().ToLowerInvariant();

    const string sql = """
        select
          l.id,
          l.customer_id,
          l.lead_status,
          l.lead_priority,
          l.assigned_user_id,
          u.full_name,
          l.created_at,
          c.customer_ref,
          c.mid,
          co.display_name,
          c.trading_name,
          ca.line1,
          ca.normalized_postcode,
          cp.phone,
          cp.email,
          (
            select count(*)
            from paymentsense_core.lead_prospects lp
            where lp.lead_id = l.id
          ) as prospect_count,
          (
            select count(*)
            from paymentsense_core.lead_contact_history h
            where h.lead_id = l.id
          ) as contact_history_count
        from paymentsense_core.leads l
        left join paymentsense_core.users u on u.id = l.assigned_user_id
        join paymentsense_core.customers c on c.id = l.customer_id
        join paymentsense_core.organisations co on co.id = c.organisation_id
        left join lateral (
          select line1, normalized_postcode
          from paymentsense_core.addresses
          where organisation_id = co.id
          order by id desc
          limit 1
        ) ca on true
        left join lateral (
          select pc.phone, pc.email
          from paymentsense_core.lead_prospects lp
          join paymentsense_core.prospects p on p.id = lp.prospect_id
          join paymentsense_core.organisations po on po.id = p.organisation_id
          left join lateral (
            select phone, email
            from paymentsense_core.contacts
            where organisation_id = po.id
            order by id desc
            limit 1
          ) pc on true
          where lp.lead_id = l.id
          order by lp.is_primary desc, p.prospect_id
          limit 1
        ) cp on true
        where (
            @search_text = ''
            or lower(co.display_name) like @search_like
            or lower(coalesce(c.customer_ref, '')) like @search_like
            or lower(coalesce(c.mid, '')) like @search_like
            or lower(coalesce(c.trading_name, '')) like @search_like
            or lower(coalesce(ca.line1, '')) like @search_like
            or lower(coalesce(ca.normalized_postcode, '')) like @search_like
            or lower(coalesce(cp.phone, '')) like @search_like
            or lower(coalesce(cp.email, '')) like @search_like
            or lower(l.lead_status) like @search_like
            or lower(coalesce(l.lead_priority, '')) like @search_like
          )
        order by l.created_at desc, l.id desc
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("search_text", normalizedSearch);
    command.Parameters.AddWithValue("search_like", $"%{normalizedSearch}%");

    var rows = new List<LeadResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new LeadResponse(
            reader.GetInt64(0),
            reader.GetInt64(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetInt64(4),
            reader.GetNullableString(5),
            reader.GetDateTime(6),
            reader.GetNullableString(7),
            reader.GetNullableString(8),
            reader.GetString(9),
            reader.GetNullableString(10),
            reader.GetNullableString(11),
            reader.GetNullableString(12),
            reader.GetNullableString(13),
            reader.GetNullableString(14),
            reader.GetInt64(15),
            reader.GetInt64(16),
            Array.Empty<LeadProspectResponse>()));
    }

    if (rows.Count == 0)
    {
        return rows;
    }

    var prospectsByLeadId = await LoadLeadProspectsByLeadIdsAsync(db, rows.Select(row => row.Id).ToArray());
    var withProspects = rows
        .Select(row => row with
        {
            Prospects = prospectsByLeadId.TryGetValue(row.Id, out var prospects)
                ? prospects
                : Array.Empty<LeadProspectResponse>()
        })
        .ToList();

    var gdprLeadIds = await LoadGdprMatchedLeadIdsAsync(db, withProspects);
    return withProspects
        .Select(row => gdprLeadIds.Contains(row.Id) ? row with { LeadStatus = "GDPR" } : row)
        .Where(row => !assignedUserId.HasValue || row.AssignedUserId == assignedUserId.Value)
        .Where(row => statusFilter.Length == 0 || string.Equals(row.LeadStatus, statusFilter, StringComparison.OrdinalIgnoreCase))
        .ToList();
}

static async Task<IReadOnlyList<LeadResponse>> LoadCampaignWaveLeadsAsync(NpgsqlDataSource db, long waveId)
{
    const string sql = """
        select
          l.id,
          l.customer_id,
          l.lead_status,
          l.lead_priority,
          l.assigned_user_id,
          u.full_name,
          l.created_at,
          c.customer_ref,
          c.mid,
          co.display_name,
          c.trading_name,
          ca.line1,
          ca.normalized_postcode,
          cp.phone,
          cp.email,
          (
            select count(*)
            from paymentsense_core.lead_prospects lp
            where lp.lead_id = l.id
          ) as prospect_count,
          (
            select count(*)
            from paymentsense_core.lead_contact_history h
            where h.lead_id = l.id
          ) as contact_history_count
        from paymentsense_core.campaign_wave_leads cwl
        join paymentsense_core.leads l on l.id = cwl.lead_id
        left join paymentsense_core.users u on u.id = l.assigned_user_id
        join paymentsense_core.customers c on c.id = l.customer_id
        join paymentsense_core.organisations co on co.id = c.organisation_id
        left join lateral (
          select line1, normalized_postcode
          from paymentsense_core.addresses
          where organisation_id = co.id
          order by id desc
          limit 1
        ) ca on true
        left join lateral (
          select pc.phone, pc.email
          from paymentsense_core.lead_prospects lp
          join paymentsense_core.prospects p on p.id = lp.prospect_id
          join paymentsense_core.organisations po on po.id = p.organisation_id
          left join lateral (
            select phone, email
            from paymentsense_core.contacts
            where organisation_id = po.id
            order by id desc
            limit 1
          ) pc on true
          where lp.lead_id = l.id
          order by lp.is_primary desc, p.prospect_id
          limit 1
        ) cp on true
        where cwl.campaign_wave_id = @wave_id
        order by l.created_at desc, l.id desc
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("wave_id", waveId);

    var rows = new List<LeadResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new LeadResponse(
            reader.GetInt64(0),
            reader.GetInt64(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetInt64(4),
            reader.GetNullableString(5),
            reader.GetDateTime(6),
            reader.GetNullableString(7),
            reader.GetNullableString(8),
            reader.GetString(9),
            reader.GetNullableString(10),
            reader.GetNullableString(11),
            reader.GetNullableString(12),
            reader.GetNullableString(13),
            reader.GetNullableString(14),
            reader.GetInt64(15),
            reader.GetInt64(16),
            Array.Empty<LeadProspectResponse>()));
    }

    if (rows.Count == 0)
    {
        return Array.Empty<LeadResponse>();
    }

    var prospectsByLeadId = await LoadLeadProspectsByLeadIdsAsync(db, rows.Select(row => row.Id).ToArray());
    return rows
        .Select(row => row with
        {
            Prospects = prospectsByLeadId.TryGetValue(row.Id, out var prospects)
                ? prospects
                : Array.Empty<LeadProspectResponse>()
        })
        .ToList();
}

static async Task<IReadOnlyList<LeadStatusResponse>> LoadLeadStatusesAsync(NpgsqlDataSource db)
{
    const string sql = """
        select id, name, sort_order, created_at, updated_at
        from paymentsense_core.lead_statuses
        order by sort_order asc, name asc, id asc
        """;

    await using var command = db.CreateCommand(sql);
    var rows = new List<LeadStatusResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new LeadStatusResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetInt32(2),
            reader.GetDateTime(3),
            reader.GetDateTime(4)));
    }

    return rows;
}

static async Task<IReadOnlyList<CompanySicCodeResponse>> LoadCompanySicCodesAsync(NpgsqlDataSource db)
{
    const string sql = """
        select code, description
        from paymentsense_core.company_sic_codes
        order by code asc
        """;

    await using var command = db.CreateCommand(sql);
    var rows = new List<CompanySicCodeResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new CompanySicCodeResponse(
            reader.GetString(0),
            reader.GetString(1)));
    }

    return rows;
}

static async Task<IReadOnlyList<BusinessTypeResponse>> LoadBusinessTypesAsync(NpgsqlDataSource db)
{
    const string sql = """
        select
          bt.id,
          bt.name,
          bt.sic_code,
          sic.description,
          bt.created_at,
          bt.updated_at
        from paymentsense_core.business_types bt
        left join paymentsense_core.company_sic_codes sic on sic.code = bt.sic_code
        order by bt.name asc, bt.id asc
        """;

    await using var command = db.CreateCommand(sql);
    var rows = new List<BusinessTypeResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new BusinessTypeResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetNullableString(2),
            reader.GetNullableString(3),
            reader.GetDateTime(4),
            reader.GetDateTime(5)));
    }

    return rows;
}

static async Task<IReadOnlyList<CustomerBusinessTypeOptionResponse>> LoadCustomerBusinessTypeOptionsAsync(NpgsqlDataSource db)
{
    const string sql = """
        select
          'custom:' || bt.id::text as key,
          bt.name,
          bt.sic_code,
          sic.description,
          'custom' as source
        from paymentsense_core.business_types bt
        left join paymentsense_core.company_sic_codes sic on sic.code = bt.sic_code
        union all
        select
          'sic:' || sic.code as key,
          sic.description,
          sic.code,
          sic.description,
          'sic' as source
        from paymentsense_core.company_sic_codes sic
        order by source asc, name asc
        """;

    await using var command = db.CreateCommand(sql);
    var rows = new List<CustomerBusinessTypeOptionResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new CustomerBusinessTypeOptionResponse(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetNullableString(2),
            reader.GetNullableString(3),
            reader.GetString(4)));
    }

    return rows;
}

static async Task<IReadOnlyList<CustomerBusinessTypeResponse>> LoadCustomerBusinessTypesAsync(NpgsqlDataSource db, long customerId)
{
    const string sql = """
        select
          case
            when link.business_type_id is not null then 'custom:' || link.business_type_id::text
            else 'sic:' || link.sic_code
          end as key,
          coalesce(bt.name, sic.description) as name,
          coalesce(link.sic_code, bt.sic_code) as sic_code,
          sic.description,
          case
            when link.business_type_id is not null then 'custom'
            else 'sic'
          end as source
        from paymentsense_core.customer_business_type_links link
        left join paymentsense_core.business_types bt on bt.id = link.business_type_id
        left join paymentsense_core.company_sic_codes sic on sic.code = coalesce(link.sic_code, bt.sic_code)
        where link.customer_id = @customer_id
        order by source asc, name asc
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("customer_id", customerId);
    var rows = new List<CustomerBusinessTypeResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new CustomerBusinessTypeResponse(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetNullableString(2),
            reader.GetNullableString(3),
            reader.GetString(4)));
    }

    return rows;
}

static async Task<CustomerBusinessTypeSelectionParseResult> ParseCustomerBusinessTypeSelectionsAsync(NpgsqlDataSource db, IReadOnlyCollection<string> keys)
{
    var normalizedKeys = keys
        .Select(static key => key.Trim())
        .Where(static key => !string.IsNullOrWhiteSpace(key))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();

    if (normalizedKeys.Length == 0)
    {
        return new CustomerBusinessTypeSelectionParseResult(true, Array.Empty<CustomerBusinessTypeLinkSelection>(), null);
    }

    var selections = new List<CustomerBusinessTypeLinkSelection>(normalizedKeys.Length);
    foreach (var key in normalizedKeys)
    {
        if (key.StartsWith("custom:", StringComparison.OrdinalIgnoreCase))
        {
            if (!long.TryParse(key["custom:".Length..], out var businessTypeId) || businessTypeId <= 0)
            {
                return new CustomerBusinessTypeSelectionParseResult(false, Array.Empty<CustomerBusinessTypeLinkSelection>(), $"Invalid business type key '{key}'.");
            }

            await using var command = db.CreateCommand("""
                select exists(
                  select 1
                  from paymentsense_core.business_types
                  where id = @business_type_id
                )
                """);
            command.Parameters.AddWithValue("business_type_id", businessTypeId);
            var exists = (bool?)await command.ExecuteScalarAsync() ?? false;
            if (!exists)
            {
                return new CustomerBusinessTypeSelectionParseResult(false, Array.Empty<CustomerBusinessTypeLinkSelection>(), $"Business type '{key}' was not found.");
            }

            selections.Add(new CustomerBusinessTypeLinkSelection(businessTypeId, null));
            continue;
        }

        if (key.StartsWith("sic:", StringComparison.OrdinalIgnoreCase))
        {
            var sicCode = key["sic:".Length..].Trim();
            if (string.IsNullOrWhiteSpace(sicCode) || !await CompanySicCodeExistsAsync(db, sicCode))
            {
                return new CustomerBusinessTypeSelectionParseResult(false, Array.Empty<CustomerBusinessTypeLinkSelection>(), $"SIC code '{key}' was not found.");
            }

            selections.Add(new CustomerBusinessTypeLinkSelection(null, sicCode));
            continue;
        }

        return new CustomerBusinessTypeSelectionParseResult(false, Array.Empty<CustomerBusinessTypeLinkSelection>(), $"Invalid business type key '{key}'.");
    }

    return new CustomerBusinessTypeSelectionParseResult(true, selections, null);
}

static async Task<IReadOnlyList<CustomerActivityStatusResponse>> LoadCustomerActivityStatusesAsync(NpgsqlDataSource db)
{
    const string sql = """
        select id, name, sort_order, created_at, updated_at
        from paymentsense_core.customer_activity_statuses
        order by sort_order asc, name asc, id asc
        """;

    await using var command = db.CreateCommand(sql);
    var rows = new List<CustomerActivityStatusResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new CustomerActivityStatusResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetInt32(2),
            reader.GetDateTime(3),
            reader.GetDateTime(4)));
    }

    return rows;
}

static async Task<IReadOnlyList<CustomerValueTypeResponse>> LoadCustomerValueTypesAsync(NpgsqlDataSource db)
{
    const string sql = """
        select id, shield_order, shield_key, image_file_name, label, decimal_value, created_at, updated_at
        from paymentsense_core.customer_value_types
        order by shield_order asc
        """;

    await using var command = db.CreateCommand(sql);
    var rows = new List<CustomerValueTypeResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new CustomerValueTypeResponse(
            reader.GetInt64(0),
            reader.GetInt32(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetNullableString(4),
            reader.IsDBNull(5) ? null : reader.GetDecimal(5),
            reader.GetDateTime(6),
            reader.GetDateTime(7)));
    }

    return rows;
}

static async Task<bool> CustomerValueTypeExistsAsync(NpgsqlDataSource db, long customerValueTypeId)
{
    await using var command = db.CreateCommand("""
        select exists(
          select 1
          from paymentsense_core.customer_value_types
          where id = @customer_value_type_id
        )
        """);
    command.Parameters.AddWithValue("customer_value_type_id", customerValueTypeId);
    return (bool?)await command.ExecuteScalarAsync() ?? false;
}

static async Task<bool> CompanySicCodeExistsAsync(NpgsqlDataSource db, string sicCode)
{
    await using var command = db.CreateCommand("""
        select exists(
          select 1
          from paymentsense_core.company_sic_codes
          where code = @code
        )
        """);
    command.Parameters.AddWithValue("code", sicCode);
    return (bool?)await command.ExecuteScalarAsync() ?? false;
}

static async Task<bool> LeadStatusExistsAsync(NpgsqlDataSource db, string leadStatus)
{
    var normalizedName = TextNormalizer.NormalizeLooseText(leadStatus);
    if (string.IsNullOrWhiteSpace(normalizedName))
    {
        return false;
    }

    await using var command = db.CreateCommand("""
        select exists(
          select 1
          from paymentsense_core.lead_statuses
          where normalized_name = @normalized_name
        )
        """);
    command.Parameters.AddWithValue("normalized_name", normalizedName);
    return (bool?)await command.ExecuteScalarAsync() ?? false;
}

static bool IsValidLeadPriority(string? leadPriority) =>
    leadPriority is not null && leadPriority.Trim().ToLowerInvariant() is "very_low" or "low" or "medium" or "high" or "urgent";

static string FormatLeadPriorityLabel(string? leadPriority) =>
    leadPriority?.Trim().ToLowerInvariant() switch
    {
        "very_low" => "Very low",
        "low" => "Low",
        "medium" => "Medium",
        "high" => "High",
        "urgent" => "Urgent",
        _ => "Medium"
    };

static async Task<int> GetNextLeadStatusSortOrderAsync(NpgsqlDataSource db)
{
    await using var command = db.CreateCommand("""
        select coalesce(max(sort_order), 0) + 10
        from paymentsense_core.lead_statuses
        """);
    return Convert.ToInt32(await command.ExecuteScalarAsync() ?? 10, CultureInfo.InvariantCulture);
}

static async Task<int> GetNextCustomerActivityStatusSortOrderAsync(NpgsqlDataSource db)
{
    await using var command = db.CreateCommand("""
        select coalesce(max(sort_order), 0) + 10
        from paymentsense_core.customer_activity_statuses
        """);
    return Convert.ToInt32(await command.ExecuteScalarAsync() ?? 10, CultureInfo.InvariantCulture);
}

static async Task<long?> ResolveCustomerActivityStatusIdByNameAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string normalizedName)
{
    await using var command = new NpgsqlCommand("""
        select id
        from paymentsense_core.customer_activity_statuses
        where normalized_name = @normalized_name
        order by id
        limit 1
        """, connection, transaction);
    command.Parameters.AddWithValue("normalized_name", normalizedName);
    var result = await command.ExecuteScalarAsync();
    return result is long id ? id : null;
}

static async Task<HashSet<long>> LoadGdprMatchedLeadIdsAsync(NpgsqlDataSource db, IReadOnlyList<LeadResponse> leads)
{
    if (leads.Count == 0)
    {
        return [];
    }

    const string sql = """
        select normalized_email, normalized_name, normalized_address
        from paymentsense_core.gdpr
        where normalized_email is not null
           or normalized_name is not null
           or normalized_address is not null
        """;

    var emails = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    var addresses = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    await using (var command = db.CreateCommand(sql))
    await using (var reader = await command.ExecuteReaderAsync())
    {
        while (await reader.ReadAsync())
        {
            var email = reader.GetNullableString(0);
            var name = reader.GetNullableString(1);
            var address = reader.GetNullableString(2);
            if (!string.IsNullOrWhiteSpace(email)) emails.Add(email);
            if (!string.IsNullOrWhiteSpace(name)) names.Add(name);
            if (!string.IsNullOrWhiteSpace(address)) addresses.Add(address);
        }
    }

    if (emails.Count == 0 && names.Count == 0 && addresses.Count == 0)
    {
        return [];
    }

    var matched = new HashSet<long>();
    foreach (var lead in leads)
    {
        if (names.Contains(TextNormalizer.NormalizeOrganisationName(lead.CustomerName)))
        {
            matched.Add(lead.Id);
            continue;
        }

        if (!string.IsNullOrWhiteSpace(lead.TradingName) && names.Contains(TextNormalizer.NormalizeOrganisationName(lead.TradingName)))
        {
            matched.Add(lead.Id);
            continue;
        }

        if (!string.IsNullOrWhiteSpace(lead.TradingAddress) && addresses.Contains(TextNormalizer.NormalizeLooseText(lead.TradingAddress)!))
        {
            matched.Add(lead.Id);
            continue;
        }

        var prospectMatched = lead.Prospects.Any(prospect =>
            (!string.IsNullOrWhiteSpace(prospect.ContactEmail) && emails.Contains(TextNormalizer.NormalizeEmail(prospect.ContactEmail)!)) ||
            names.Contains(TextNormalizer.NormalizeOrganisationName(prospect.BusinessName)) ||
            (!string.IsNullOrWhiteSpace(prospect.ContactName) && names.Contains(TextNormalizer.NormalizeOrganisationName(prospect.ContactName))) ||
            (!string.IsNullOrWhiteSpace(prospect.AddressLine1) && addresses.Contains(TextNormalizer.NormalizeLooseText(prospect.AddressLine1)!)));

        if (prospectMatched)
        {
            matched.Add(lead.Id);
        }
    }

    return matched;
}

static async Task<IReadOnlyList<CampaignResponse>> LoadCampaignsAsync(NpgsqlDataSource db)
{
    const string campaignsSql = """
        select
          id,
          name,
          description,
          objective,
          start_date,
          end_date,
          target_audience,
          budget,
          product_service,
          status,
          created_at
        from paymentsense_core.campaigns
        order by created_at desc, id desc
        """;

    var campaigns = new List<CampaignResponse>();
    await using (var command = db.CreateCommand(campaignsSql))
    await using (var reader = await command.ExecuteReaderAsync())
    {
        while (await reader.ReadAsync())
        {
            campaigns.Add(new CampaignResponse(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetNullableString(2),
                reader.GetNullableString(3),
                reader.IsDBNull(4) ? null : reader.GetFieldValue<DateOnly>(4),
                reader.IsDBNull(5) ? null : reader.GetFieldValue<DateOnly>(5),
                reader.GetNullableString(6),
                reader.IsDBNull(7) ? null : reader.GetDecimal(7),
                reader.GetNullableString(8),
                reader.GetString(9),
                reader.GetDateTime(10),
                Array.Empty<CampaignWaveResponse>()));
        }
    }

    if (campaigns.Count == 0)
    {
        return campaigns;
    }

    const string wavesSql = """
        select
          id,
          campaign_id,
          name,
          wave_number,
          channel,
          scheduled_date,
          status,
          assigned_team_or_user,
          created_at
        from paymentsense_core.campaign_waves
        where campaign_id = any(@campaign_ids)
        order by campaign_id, wave_number, id
        """;

    var wavesByCampaignId = new Dictionary<long, List<CampaignWaveResponse>>();
    await using (var command = db.CreateCommand(wavesSql))
    {
        command.Parameters.AddWithValue("campaign_ids", campaigns.Select(campaign => campaign.Id).ToArray());
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var campaignId = reader.GetInt64(1);
            if (!wavesByCampaignId.TryGetValue(campaignId, out var waves))
            {
                waves = [];
                wavesByCampaignId[campaignId] = waves;
            }

            waves.Add(new CampaignWaveResponse(
                reader.GetInt64(0),
                campaignId,
                reader.GetString(2),
                reader.GetInt32(3),
                reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetFieldValue<DateOnly>(5),
                reader.GetString(6),
                reader.GetNullableString(7),
                reader.GetDateTime(8)));
        }
    }

    return campaigns
        .Select(campaign => campaign with
        {
            Waves = wavesByCampaignId.TryGetValue(campaign.Id, out var waves)
                ? waves
                : Array.Empty<CampaignWaveResponse>()
        })
        .ToList();
}

static string? NullIfBlank(string? value) =>
    string.IsNullOrWhiteSpace(value) ? null : value.Trim();

static DateTime ParseDateTimeOrNow(string? value)
{
    var trimmed = NullIfBlank(value);
    if (trimmed is null)
    {
        return DateTime.UtcNow;
    }

    return DateTime.TryParse(trimmed, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var parsed)
        ? parsed.ToUniversalTime()
        : DateTime.UtcNow;
}

static string? NormalizeUserColor(string? value)
{
    var trimmed = NullIfBlank(value);
    if (trimmed is null)
    {
        return null;
    }

    return Regex.IsMatch(trimmed, "^#[0-9A-Fa-f]{6}$") ? trimmed.ToLowerInvariant() : null;
}

static DateOnly? ParseDateOrNull(string? value) =>
    DateOnly.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
        ? parsed
        : null;

static object ParseDecimalOrDbNull(string? value) =>
    decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed)
        ? parsed
        : DBNull.Value;

static async Task<Dictionary<long, IReadOnlyList<LeadProspectResponse>>> LoadLeadProspectsByLeadIdsAsync(NpgsqlDataSource db, IReadOnlyList<long> leadIds)
{
    if (leadIds.Count == 0)
    {
        return [];
    }

    const string sql = """
        select
          lp.lead_id,
          p.prospect_id,
          po.display_name,
          pc.full_name,
          pc.email,
          p.owner_name,
          pa.line1,
          pa.normalized_postcode,
          lp.is_primary
        from paymentsense_core.lead_prospects lp
        join paymentsense_core.prospects p on p.id = lp.prospect_id
        join paymentsense_core.organisations po on po.id = p.organisation_id
        left join lateral (
          select full_name, email
          from paymentsense_core.contacts
          where organisation_id = po.id
          order by id desc
          limit 1
        ) pc on true
        left join lateral (
          select line1, normalized_postcode
          from paymentsense_core.addresses
          where organisation_id = po.id
          order by id desc
          limit 1
        ) pa on true
        where lp.lead_id = any(@lead_ids)
        order by lp.lead_id, lp.is_primary desc, p.prospect_id
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("lead_ids", leadIds.ToArray());

    var result = new Dictionary<long, List<LeadProspectResponse>>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        var leadId = reader.GetInt64(0);
        if (!result.TryGetValue(leadId, out var prospects))
        {
            prospects = [];
            result[leadId] = prospects;
        }

        prospects.Add(new LeadProspectResponse(
            reader.GetString(1),
            reader.GetString(2),
            reader.GetNullableString(3),
            reader.GetNullableString(4),
            reader.GetNullableString(5),
            reader.GetNullableString(6),
            reader.GetNullableString(7),
            reader.GetBoolean(8)));
    }

    return result.ToDictionary(
        pair => pair.Key,
        pair => (IReadOnlyList<LeadProspectResponse>)pair.Value);
}

static async Task<LeadDetailResponse?> UpdateLeadPrimaryProspectAsync(NpgsqlDataSource db, long leadId, string prospectId)
{
    await using var transaction = await db.OpenConnectionAsync();
    await using var dbTransaction = await transaction.BeginTransactionAsync();

    long? selectedProspectDbId;
    await using (var selectedCommand = new NpgsqlCommand("""
        select p.id
        from paymentsense_core.lead_prospects lp
        join paymentsense_core.prospects p on p.id = lp.prospect_id
        where lp.lead_id = @lead_id
          and p.prospect_id = @prospect_id
        """, transaction, dbTransaction))
    {
        selectedCommand.Parameters.AddWithValue("lead_id", leadId);
        selectedCommand.Parameters.AddWithValue("prospect_id", prospectId);
        selectedProspectDbId = (long?) await selectedCommand.ExecuteScalarAsync();
    }

    if (!selectedProspectDbId.HasValue)
    {
        await dbTransaction.RollbackAsync();
        return null;
    }

    await using (var updateLinks = new NpgsqlCommand("""
        update paymentsense_core.lead_prospects
        set is_primary = prospect_id = @prospect_db_id,
            updated_at = now()
        where lead_id = @lead_id
        """, transaction, dbTransaction))
    {
        updateLinks.Parameters.AddWithValue("lead_id", leadId);
        updateLinks.Parameters.AddWithValue("prospect_db_id", selectedProspectDbId.Value);
        await updateLinks.ExecuteNonQueryAsync();
    }

    await using (var updateLead = new NpgsqlCommand("""
        update paymentsense_core.leads
        set primary_prospect_id = @prospect_db_id,
            updated_at = now()
        where id = @lead_id
        """, transaction, dbTransaction))
    {
        updateLead.Parameters.AddWithValue("lead_id", leadId);
        updateLead.Parameters.AddWithValue("prospect_db_id", selectedProspectDbId.Value);
        await updateLead.ExecuteNonQueryAsync();
    }

    await dbTransaction.CommitAsync();
    return await LoadLeadDetailAsync(db, leadId);
}

static async Task<LeadDetailResponse?> UpdateLeadStatusAsync(NpgsqlDataSource db, long leadId, string leadStatus)
{
    await using var command = db.CreateCommand("""
        update paymentsense_core.leads
        set lead_status = @lead_status,
            updated_at = now()
        where id = @lead_id
        """);
    command.Parameters.AddWithValue("lead_status", leadStatus);
    command.Parameters.AddWithValue("lead_id", leadId);
    var affected = await command.ExecuteNonQueryAsync();
    if (affected == 0)
    {
        return null;
    }

    return await LoadLeadDetailAsync(db, leadId);
}

static async Task<LeadDetailResponse?> UpdateLeadPriorityAsync(NpgsqlDataSource db, long leadId, string leadPriority)
{
    await using var command = db.CreateCommand("""
        update paymentsense_core.leads
        set lead_priority = @lead_priority,
            updated_at = now()
        where id = @lead_id
        """);
    command.Parameters.AddWithValue("lead_priority", leadPriority);
    command.Parameters.AddWithValue("lead_id", leadId);
    var affected = await command.ExecuteNonQueryAsync();
    if (affected == 0)
    {
        return null;
    }

    return await LoadLeadDetailAsync(db, leadId);
}

static async Task<LeadDetailResponse?> UpdateLeadAssignedUserAsync(NpgsqlDataSource db, long leadId, long? assignedUserId)
{
    if (assignedUserId.HasValue)
    {
        await using var userExistsCommand = db.CreateCommand("""
            select exists(
              select 1
              from paymentsense_core.users
              where id = @user_id
            )
            """);
        userExistsCommand.Parameters.AddWithValue("user_id", assignedUserId.Value);
        var userExists = (bool)(await userExistsCommand.ExecuteScalarAsync() ?? false);
        if (!userExists)
        {
            return null;
        }
    }

    await using var command = db.CreateCommand("""
        update paymentsense_core.leads
        set assigned_user_id = @assigned_user_id,
            updated_at = now()
        where id = @lead_id
        """);
    command.Parameters.AddWithValue("assigned_user_id", (object?)assignedUserId ?? DBNull.Value);
    command.Parameters.AddWithValue("lead_id", leadId);
    var affected = await command.ExecuteNonQueryAsync();
    if (affected == 0)
    {
        return null;
    }

    return await LoadLeadDetailAsync(db, leadId);
}

static string BuildLeadsCsv(IReadOnlyList<LeadResponse> rows)
{
    static string Escape(string? value) => $"\"{(value ?? string.Empty).Replace("\"", "\"\"")}\"";
    static string FlattenProspects(IReadOnlyList<LeadProspectResponse> prospects, Func<LeadProspectResponse, string?> selector) =>
        string.Join(" | ", prospects.Select(selector).Where(value => !string.IsNullOrWhiteSpace(value)).Select(value => value!.Trim()).Distinct(StringComparer.OrdinalIgnoreCase));
    static string FlattenProspectFlags(IReadOnlyList<LeadProspectResponse> prospects) =>
        string.Join(" | ", prospects.Select(prospect => $"{prospect.ProspectId}:{(prospect.IsPrimary ? "primary" : "linked")}"));

    var lines = new List<string>
    {
        "LeadId,CustomerRef,MID,CustomerName,TradingName,TradingAddress,Postcode,ContactPhone,ContactEmail,ProspectCount,ContactHistoryCount,LeadStatus,CreatedAt,ProspectIds,ProspectBusinessNames,ProspectContactNames,ProspectContactEmails,ProspectAddresses,ProspectPostcodes,ProspectLinkTypes"
    };

    foreach (var row in rows)
    {
        lines.Add(string.Join(",",
            Escape(row.Id.ToString(CultureInfo.InvariantCulture)),
            Escape(row.CustomerRef),
            Escape(row.Mid),
            Escape(row.CustomerName),
            Escape(row.TradingName),
            Escape(row.TradingAddress),
            Escape(row.Postcode),
            Escape(row.ContactPhone),
            Escape(row.ContactEmail),
            Escape(row.ProspectCount.ToString(CultureInfo.InvariantCulture)),
            Escape(row.ContactHistoryCount.ToString(CultureInfo.InvariantCulture)),
            Escape(row.LeadStatus),
            Escape(row.CreatedAt.ToString("O", CultureInfo.InvariantCulture)),
            Escape(FlattenProspects(row.Prospects, prospect => prospect.ProspectId)),
            Escape(FlattenProspects(row.Prospects, prospect => prospect.BusinessName)),
            Escape(FlattenProspects(row.Prospects, prospect => prospect.ContactName)),
            Escape(FlattenProspects(row.Prospects, prospect => prospect.ContactEmail)),
            Escape(FlattenProspects(row.Prospects, prospect => prospect.AddressLine1)),
            Escape(FlattenProspects(row.Prospects, prospect => prospect.Postcode)),
            Escape(FlattenProspectFlags(row.Prospects))));
    }

    return string.Join("\n", lines);
}

static async Task<LeadDetailResponse?> LoadLeadDetailAsync(NpgsqlDataSource db, long leadId)
{
    const string leadSql = """
        select
          l.id,
          l.customer_id,
          l.lead_status,
          l.lead_priority,
          l.assigned_user_id,
          u.full_name,
          l.created_at,
          c.customer_ref,
          c.mid,
          co.display_name,
          c.trading_name,
          ca.line1,
          ca.normalized_postcode,
          cp.phone,
          cp.email
        from paymentsense_core.leads l
        left join paymentsense_core.users u on u.id = l.assigned_user_id
        join paymentsense_core.customers c on c.id = l.customer_id
        join paymentsense_core.organisations co on co.id = c.organisation_id
        left join lateral (
          select line1, normalized_postcode
          from paymentsense_core.addresses
          where organisation_id = co.id
          order by id desc
          limit 1
        ) ca on true
        left join lateral (
          select pc.phone, pc.email
          from paymentsense_core.lead_prospects lp
          join paymentsense_core.prospects p on p.id = lp.prospect_id
          join paymentsense_core.organisations po on po.id = p.organisation_id
          left join lateral (
            select phone, email
            from paymentsense_core.contacts
            where organisation_id = po.id
            order by id desc
            limit 1
          ) pc on true
          where lp.lead_id = l.id
          order by lp.is_primary desc, p.prospect_id
          limit 1
        ) cp on true
        where l.id = @lead_id
        """;

    await using var command = db.CreateCommand(leadSql);
    command.Parameters.AddWithValue("lead_id", leadId);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    var lead = new LeadResponse(
        reader.GetInt64(0),
        reader.GetInt64(1),
        reader.GetString(2),
        reader.GetString(3),
        reader.IsDBNull(4) ? null : reader.GetInt64(4),
        reader.GetNullableString(5),
        reader.GetDateTime(6),
        reader.GetNullableString(7),
        reader.GetNullableString(8),
        reader.GetString(9),
        reader.GetNullableString(10),
        reader.GetNullableString(11),
        reader.GetNullableString(12),
        reader.GetNullableString(13),
        reader.GetNullableString(14),
        0,
        0,
        Array.Empty<LeadProspectResponse>());
    var commercials = await LoadCustomerCommercialsAsync(db, lead.CustomerId);

    await reader.DisposeAsync();

    const string prospectsSql = """
        select
          p.prospect_id,
          po.display_name,
          pc.full_name,
          pc.email,
          p.owner_name,
          pa.line1,
          pa.normalized_postcode,
          lp.is_primary
        from paymentsense_core.lead_prospects lp
        join paymentsense_core.prospects p on p.id = lp.prospect_id
        join paymentsense_core.organisations po on po.id = p.organisation_id
        left join lateral (
          select full_name, email
          from paymentsense_core.contacts
          where organisation_id = po.id
          order by id desc
          limit 1
        ) pc on true
        left join lateral (
          select line1, normalized_postcode
          from paymentsense_core.addresses
          where organisation_id = po.id
          order by id desc
          limit 1
        ) pa on true
        where lp.lead_id = @lead_id
        order by lp.is_primary desc, p.prospect_id
        """;

    await using var prospectsCommand = db.CreateCommand(prospectsSql);
    prospectsCommand.Parameters.AddWithValue("lead_id", leadId);
    var prospects = new List<LeadProspectResponse>();
    await using var prospectsReader = await prospectsCommand.ExecuteReaderAsync();
    while (await prospectsReader.ReadAsync())
    {
        prospects.Add(new LeadProspectResponse(
            prospectsReader.GetString(0),
            prospectsReader.GetString(1),
            prospectsReader.GetNullableString(2),
            prospectsReader.GetNullableString(3),
            prospectsReader.GetNullableString(4),
            prospectsReader.GetNullableString(5),
            prospectsReader.GetNullableString(6),
            prospectsReader.GetBoolean(7)));
    }

    const string historySql = """
        select id, channel, contacted_at, outcome, notes, reason, who_by, response_status
        from paymentsense_core.lead_contact_history
        where lead_id = @lead_id
        order by contacted_at desc, id desc
        """;

    await using var historyCommand = db.CreateCommand(historySql);
    historyCommand.Parameters.AddWithValue("lead_id", leadId);
    var history = new List<LeadContactHistoryResponse>();
    await using var historyReader = await historyCommand.ExecuteReaderAsync();
    while (await historyReader.ReadAsync())
    {
        history.Add(new LeadContactHistoryResponse(
            historyReader.GetInt64(0),
            historyReader.GetString(1),
            historyReader.GetDateTime(2),
            historyReader.GetNullableString(3),
            historyReader.GetNullableString(4),
            historyReader.GetNullableString(5),
            historyReader.GetNullableString(6),
            historyReader.GetNullableString(7)));
    }

    var notes = await LoadLeadNotesAsync(db, leadId);

    var effectiveStatus = (await LoadGdprMatchedLeadIdsAsync(db, [lead with { Prospects = prospects }])).Contains(lead.Id)
        ? "GDPR"
        : lead.LeadStatus;

    return new LeadDetailResponse
    {
        Id = lead.Id,
        CustomerId = lead.CustomerId,
        LeadStatus = effectiveStatus,
        LeadPriority = lead.LeadPriority,
        AssignedUserId = lead.AssignedUserId,
        AssignedUserName = lead.AssignedUserName,
        CreatedAt = lead.CreatedAt,
        CustomerRef = lead.CustomerRef,
        Mid = lead.Mid,
        CustomerName = lead.CustomerName,
        TradingName = lead.TradingName,
        TradingAddress = lead.TradingAddress,
        Postcode = lead.Postcode,
        ContactPhone = lead.ContactPhone,
        ContactEmail = lead.ContactEmail,
        Commercials = commercials,
        Prospects = prospects,
        ContactHistory = history,
        Notes = notes
    };
}

static async Task<bool> LeadExistsAsync(NpgsqlDataSource db, long leadId)
{
    await using var command = db.CreateCommand("""
        select exists(
          select 1
          from paymentsense_core.leads
          where id = @lead_id
        )
        """);
    command.Parameters.AddWithValue("lead_id", leadId);
    return (bool?) await command.ExecuteScalarAsync() ?? false;
}

static async Task<IReadOnlyList<LeadNoteResponse>> LoadLeadNotesAsync(NpgsqlDataSource db, long leadId)
{
    const string notesSql = """
        select
          n.id,
          n.note_text,
          n.noted_at,
          n.user_id,
          u.full_name
        from paymentsense_core.lead_notes n
        left join paymentsense_core.users u on u.id = n.user_id
        where n.lead_id = @lead_id
        order by n.noted_at desc, n.id desc
        """;

    await using var notesCommand = db.CreateCommand(notesSql);
    notesCommand.Parameters.AddWithValue("lead_id", leadId);
    var notes = new List<LeadNoteResponse>();
    await using var notesReader = await notesCommand.ExecuteReaderAsync();
    while (await notesReader.ReadAsync())
    {
        notes.Add(new LeadNoteResponse(
            notesReader.GetInt64(0),
            notesReader.GetString(1),
            notesReader.GetDateTime(2),
            notesReader.IsDBNull(3) ? null : notesReader.GetInt64(3),
            notesReader.GetNullableString(4)));
    }

    return notes;
}

static ProspectDetailResponse MapLiveProspectDetailToResponse(LiveProspectDetail detail, bool extractedNow)
{
    return new ProspectDetailResponse(
        detail.ProspectId,
        detail.BusinessName ?? detail.ProspectId,
        detail.Channel,
        detail.Origin,
        TextNormalizer.TryParseUkDate(detail.CreatedOn),
        null,
        detail.SourceUrl,
        detail.HasPaymentsenseCustomerMatch,
        detail.Address,
        detail.Contact,
        extractedNow);
}

static async Task<IReadOnlyList<GeneratedCustomerMatch>> GenerateCustomerMatchesAsync(NpgsqlDataSource db, CustomerMatchSource customer)
{
    const string sql = """
        select
          p.id,
          p.prospect_id,
          po.display_name,
          po.normalized_name,
          p.has_paymentsense_customer_match,
          pc.full_name,
          pc.email,
          pa.line1,
          pa.normalized_postcode
        from paymentsense_core.prospects p
        join paymentsense_core.organisations po on po.id = p.organisation_id
        left join lateral (
          select full_name, email
          from paymentsense_core.contacts
          where organisation_id = po.id
          order by id
          limit 1
        ) pc on true
        left join lateral (
          select line1, normalized_postcode
          from paymentsense_core.addresses
          where organisation_id = po.id
          order by id
          limit 1
        ) pa on true
        """;

    await using var command = db.CreateCommand(sql);
    var matches = new List<GeneratedCustomerMatch>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        var evaluation = EvaluateCustomerMatch(
            customer,
            reader.GetNullableString(3),
            reader.GetString(2),
            reader.GetNullableString(7),
            reader.GetNullableString(8),
            reader.IsDBNull(4) ? (bool?) null : reader.GetBoolean(4));

        if (!evaluation.Include)
        {
            continue;
        }

        matches.Add(new GeneratedCustomerMatch(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetNullableString(5),
            reader.GetNullableString(6),
            reader.GetNullableString(7),
            reader.GetNullableString(8),
            evaluation.Score,
            evaluation.Status,
            evaluation.Reasons));
    }

    return matches
        .OrderByDescending(match => match.Score)
        .ThenBy(match => match.ProspectId, StringComparer.Ordinal)
        .ToArray();
}

static MatchEvaluation EvaluateCustomerMatch(
    CustomerMatchSource customer,
    string? prospectNormalizedName,
    string prospectDisplayName,
    string? prospectAddressLine1,
    string? prospectPostcode,
    bool? hasPaymentsenseCustomerMatch)
{
    var reasons = new List<string>();
    decimal score = 0m;

    var entityName = customer.NormalizedEntityName ?? TextNormalizer.NormalizeOrganisationName(customer.EntityName);
    var tradingName = customer.NormalizedTradingName;
    var prospectName = prospectNormalizedName ?? TextNormalizer.NormalizeOrganisationName(prospectDisplayName);
    var entitySimilarity = TextNormalizer.TokenSimilarity(entityName, prospectName);
    var tradingSimilarity = TextNormalizer.TokenSimilarity(tradingName, prospectName);
    var bestNameSimilarity = Math.Max(entitySimilarity, tradingSimilarity);

    if (bestNameSimilarity >= 0.95m)
    {
        score += 0.55m;
        reasons.Add("exact business name");
    }
    else if (bestNameSimilarity >= 0.75m)
    {
        score += 0.40m;
        reasons.Add("strong business name match");
    }
    else if (bestNameSimilarity >= 0.55m)
    {
        score += 0.24m;
        reasons.Add("similar business name");
    }

    if (!string.IsNullOrWhiteSpace(customer.NormalizedPostcode) &&
        !string.IsNullOrWhiteSpace(prospectPostcode) &&
        string.Equals(customer.NormalizedPostcode, prospectPostcode, StringComparison.OrdinalIgnoreCase))
    {
        score += 0.30m;
        reasons.Add("same postcode");
    }

    var customerAddress = TextNormalizer.NormalizeLooseText(customer.TradingAddressLine1);
    var prospectAddress = TextNormalizer.NormalizeLooseText(prospectAddressLine1);
    var addressSimilarity = TextNormalizer.TokenSimilarity(customerAddress, prospectAddress);
    if (addressSimilarity >= 0.90m)
    {
        score += 0.18m;
        reasons.Add("same trading address");
    }
    else if (addressSimilarity >= 0.65m)
    {
        score += 0.10m;
        reasons.Add("similar trading address");
    }

    if (hasPaymentsenseCustomerMatch == true && bestNameSimilarity >= 0.40m)
    {
        score += 0.08m;
        reasons.Add("prospect flagged possible customer match");
    }

    score = Math.Min(score, 0.99m);
    var include = score >= 0.45m || (bestNameSimilarity >= 0.55m && reasons.Count > 0);
    var status = score >= 0.80m ? "candidate" : "needs_review";
    return new MatchEvaluation(include, score, status, reasons);
}

static async Task SaveCustomerMatchesAsync(NpgsqlDataSource db, long customerId, IReadOnlyList<GeneratedCustomerMatch> matches)
{
    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    foreach (var match in matches)
    {
        await using var command = new NpgsqlCommand("""
            insert into paymentsense_core.match_candidates (
              prospect_id,
              customer_id,
              score,
              match_status,
              reasons
            )
            values (
              @prospect_id,
              @customer_id,
              @score,
              @status,
              @reasons::jsonb
            )
            on conflict (prospect_id, customer_id) do update set
              score = excluded.score,
              match_status = excluded.match_status,
              reasons = excluded.reasons,
              generated_at = now()
            """, connection, transaction);
        command.Parameters.AddWithValue("prospect_id", match.ProspectDbId);
        command.Parameters.AddWithValue("customer_id", customerId);
        command.Parameters.AddWithValue("score", match.Score);
        command.Parameters.AddWithValue("status", match.Status);
        command.Parameters.AddWithValue("reasons", JsonSerializer.Serialize(match.Reasons));
        await command.ExecuteNonQueryAsync();
    }

    await transaction.CommitAsync();
}

static string[] ParseReasons(string value)
{
    try
    {
        return JsonSerializer.Deserialize<string[]>(value, JsonDefaults.Options) ?? [];
    }
    catch
    {
        return [];
    }
}

static async Task<ProspectDetailResponse?> LoadProspectDetailAsync(NpgsqlDataSource db, string prospectId, bool extractedNow)
{
    const string sql = """
        select
          p.prospect_id,
          o.display_name,
          p.channel,
          p.origin,
          p.created_on,
          p.owner_name,
          p.sales_url,
          p.has_paymentsense_customer_match,
          a.line1,
          a.line2,
          a.town,
          a.county,
          coalesce(a.postcode, a.normalized_postcode),
          a.country,
          c.full_name,
          c.phone,
          c.email,
          exists (
            select 1
            from paymentsense_raw.extracted_records r
            where r.record_type = 'prospect_detail'
              and r.external_id = p.prospect_id
              and r.raw_payload->>'extractorVersion' = '2'
          ) as has_detail
        from paymentsense_core.prospects p
        join paymentsense_core.organisations o on o.id = p.organisation_id
        left join lateral (
          select line1, line2, town, county, postcode, normalized_postcode, country
          from paymentsense_core.addresses
          where organisation_id = o.id
          order by id desc
          limit 1
        ) a on true
        left join lateral (
          select full_name, phone, email
          from paymentsense_core.contacts
          where organisation_id = o.id
          order by id desc
          limit 1
        ) c on true
        where p.prospect_id = @prospect_id
        """;

    await using var command = db.CreateCommand(sql);
    command.Parameters.AddWithValue("prospect_id", prospectId);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync() || !reader.GetBoolean(17))
    {
        return null;
    }

    return new ProspectDetailResponse(
        reader.GetString(0),
        reader.GetString(1),
        reader.GetNullableString(2),
        reader.GetNullableString(3),
        reader.IsDBNull(4) ? null : reader.GetFieldValue<DateOnly>(4),
        reader.GetNullableString(5),
        reader.GetNullableString(6),
        reader.IsDBNull(7) ? null : reader.GetBoolean(7),
        new ProspectAddressResponse(
            reader.GetNullableString(8),
            reader.GetNullableString(9),
            reader.GetNullableString(10),
            reader.GetNullableString(11),
            reader.GetNullableString(12),
            reader.GetNullableString(13)),
        new ProspectContactResponse(
            reader.GetNullableString(14),
            reader.GetNullableString(15),
            reader.GetNullableString(16)),
        extractedNow);
}

static async Task SaveProspectDetailAsync(NpgsqlDataSource db, LiveProspectDetail detail)
{
    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    long rawRecordId;
    await using (var command = new NpgsqlCommand("""
        insert into paymentsense_raw.extracted_records (
          record_type,
          external_id,
          source_url,
          raw_payload
        )
        values (
          'prospect_detail',
          @external_id,
          @source_url,
          @raw_payload::jsonb
        )
        returning id
        """, connection, transaction))
    {
        command.Parameters.AddWithValue("external_id", detail.ProspectId);
        command.Parameters.AddWithValue("source_url", detail.SourceUrl);
        command.Parameters.AddWithValue("raw_payload", JsonSerializer.Serialize(detail, JsonDefaults.Options));
        rawRecordId = (long) (await command.ExecuteScalarAsync() ?? 0L);
    }

    var organisationName = detail.BusinessName ?? detail.Contact.Name ?? detail.ProspectId;
    var normalizedName = TextNormalizer.NormalizeOrganisationName(organisationName);
    if (string.IsNullOrWhiteSpace(normalizedName))
    {
        normalizedName = detail.ProspectId.ToLower(CultureInfo.InvariantCulture);
    }

    long organisationId;
    await using (var command = new NpgsqlCommand("""
        insert into paymentsense_core.organisations (display_name, normalized_name, source_confidence)
        values (@display_name, @normalized_name, 0.9500)
        on conflict do nothing
        returning id
        """, connection, transaction))
    {
        command.Parameters.AddWithValue("display_name", organisationName);
        command.Parameters.AddWithValue("normalized_name", normalizedName);
        var result = await command.ExecuteScalarAsync();
        if (result is long id)
        {
            organisationId = id;
        }
        else
        {
            await using var lookup = new NpgsqlCommand("""
                select id
                from paymentsense_core.organisations
                where normalized_name = @normalized_name
                order by id
                limit 1
                """, connection, transaction);
            lookup.Parameters.AddWithValue("normalized_name", normalizedName);
            organisationId = (long) (await lookup.ExecuteScalarAsync() ?? throw new InvalidOperationException("Organisation lookup failed."));
        }
    }

    await using (var command = new NpgsqlCommand("""
        insert into paymentsense_core.prospects (
          organisation_id,
          prospect_id,
          channel,
          origin,
          created_on,
          sales_url,
          has_paymentsense_customer_match,
          raw_record_id
        )
        values (
          @organisation_id,
          @prospect_id,
          @channel,
          @origin,
          @created_on,
          @sales_url,
          @has_match,
          @raw_record_id
        )
        on conflict (prospect_id) do update set
          organisation_id = excluded.organisation_id,
          channel = excluded.channel,
          origin = excluded.origin,
          created_on = coalesce(excluded.created_on, paymentsense_core.prospects.created_on),
          sales_url = excluded.sales_url,
          has_paymentsense_customer_match = excluded.has_paymentsense_customer_match,
          raw_record_id = excluded.raw_record_id,
          updated_at = now()
        """, connection, transaction))
    {
        command.Parameters.AddWithValue("organisation_id", organisationId);
        command.Parameters.AddWithValue("prospect_id", detail.ProspectId);
        command.Parameters.AddWithValue("channel", (object?) detail.Channel ?? DBNull.Value);
        command.Parameters.AddWithValue("origin", (object?) detail.Origin ?? DBNull.Value);
        command.Parameters.AddWithValue("created_on", (object?) TextNormalizer.TryParseUkDate(detail.CreatedOn) ?? DBNull.Value);
        command.Parameters.AddWithValue("sales_url", detail.SourceUrl);
        command.Parameters.AddWithValue("has_match", (object?) detail.HasPaymentsenseCustomerMatch ?? DBNull.Value);
        command.Parameters.AddWithValue("raw_record_id", rawRecordId);
        await command.ExecuteNonQueryAsync();
    }

    if (!string.IsNullOrWhiteSpace(detail.Address.Line1) || !string.IsNullOrWhiteSpace(detail.Address.Postcode))
    {
        await using var addressCommand = new NpgsqlCommand("""
            insert into paymentsense_core.addresses (
              organisation_id,
              label,
              line1,
              line2,
              town,
              county,
              postcode,
              normalized_postcode,
              country,
              source_confidence
            )
            select
              @organisation_id,
              'registered',
              @line1,
              @line2,
              @town,
              @county,
              @postcode,
              @normalized_postcode,
              @country,
              0.9500
            where not exists (
              select 1
              from paymentsense_core.addresses
              where organisation_id = @organisation_id
                and coalesce(normalized_postcode, '') = coalesce(@normalized_postcode, '')
                and coalesce(line1, '') = coalesce(@line1, '')
            )
            """, connection, transaction);
        addressCommand.Parameters.AddWithValue("organisation_id", organisationId);
        addressCommand.Parameters.AddWithValue("line1", (object?) detail.Address.Line1 ?? DBNull.Value);
        addressCommand.Parameters.AddWithValue("line2", (object?) detail.Address.Line2 ?? DBNull.Value);
        addressCommand.Parameters.AddWithValue("town", (object?) detail.Address.Town ?? DBNull.Value);
        addressCommand.Parameters.AddWithValue("county", (object?) detail.Address.County ?? DBNull.Value);
        addressCommand.Parameters.AddWithValue("postcode", (object?) detail.Address.Postcode ?? DBNull.Value);
        addressCommand.Parameters.AddWithValue("normalized_postcode", (object?) TextNormalizer.NormalizePostcode(detail.Address.Postcode) ?? DBNull.Value);
        addressCommand.Parameters.AddWithValue("country", (object?) detail.Address.Country ?? DBNull.Value);
        await addressCommand.ExecuteNonQueryAsync();
    }

    if (!string.IsNullOrWhiteSpace(detail.Contact.Name) || !string.IsNullOrWhiteSpace(detail.Contact.Email) || !string.IsNullOrWhiteSpace(detail.Contact.Phone))
    {
        await using var contactCommand = new NpgsqlCommand("""
            insert into paymentsense_core.contacts (
              organisation_id,
              full_name,
              normalized_name,
              email,
              normalized_email,
              phone,
              normalized_phone,
              source_confidence
            )
            select
              @organisation_id,
              @full_name,
              @normalized_name,
              @email,
              @normalized_email,
              @phone,
              @normalized_phone,
              0.9500
            where not exists (
              select 1
              from paymentsense_core.contacts
              where organisation_id = @organisation_id
                and coalesce(normalized_email, '') = coalesce(@normalized_email, '')
                and coalesce(normalized_phone, '') = coalesce(@normalized_phone, '')
            )
            """, connection, transaction);
        contactCommand.Parameters.AddWithValue("organisation_id", organisationId);
        contactCommand.Parameters.AddWithValue("full_name", (object?) detail.Contact.Name ?? DBNull.Value);
        contactCommand.Parameters.AddWithValue("normalized_name", (object?) TextNormalizer.NormalizePersonName(detail.Contact.Name) ?? DBNull.Value);
        contactCommand.Parameters.AddWithValue("email", (object?) detail.Contact.Email ?? DBNull.Value);
        contactCommand.Parameters.AddWithValue("normalized_email", (object?) TextNormalizer.NormalizeEmail(detail.Contact.Email) ?? DBNull.Value);
        contactCommand.Parameters.AddWithValue("phone", (object?) detail.Contact.Phone ?? DBNull.Value);
        contactCommand.Parameters.AddWithValue("normalized_phone", (object?) TextNormalizer.NormalizePhone(detail.Contact.Phone) ?? DBNull.Value);
        await contactCommand.ExecuteNonQueryAsync();
    }

    await transaction.CommitAsync();
}

internal static class DataReaderExtensions
{
    public static string? GetNullableString(this NpgsqlDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
}

internal static class TextNormalizer
{
    private static readonly Regex NonAlphaNumeric = new("[^a-z0-9 ]+", RegexOptions.Compiled);

    public static string NormalizeOrganisationName(string value)
    {
        var lower = value.ToLower(CultureInfo.InvariantCulture)
            .Replace("&", " and ", StringComparison.Ordinal);
        var cleaned = NonAlphaNumeric.Replace(lower, " ");
        var tokens = cleaned
            .Split([' ', '.', ',', '-', '_', '/', '\\', '(', ')'], StringSplitOptions.RemoveEmptyEntries)
            .Where(token => token is not ("ltd" or "limited" or "plc" or "llp" or "the" or "and"));

        return string.Join(' ', tokens);
    }

    public static string? NormalizeLooseText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var cleaned = NonAlphaNumeric.Replace(value.ToLower(CultureInfo.InvariantCulture), " ");
        return string.Join(' ', cleaned
            .Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    public static decimal TokenSimilarity(string? left, string? right)
    {
        if (string.IsNullOrWhiteSpace(left) || string.IsNullOrWhiteSpace(right))
        {
            return 0m;
        }

        if (string.Equals(left, right, StringComparison.OrdinalIgnoreCase))
        {
            return 1m;
        }

        var leftTokens = left.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var rightTokens = right.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (leftTokens.Count == 0 || rightTokens.Count == 0)
        {
            return 0m;
        }

        var overlap = leftTokens.Intersect(rightTokens, StringComparer.OrdinalIgnoreCase).Count();
        var union = leftTokens.Union(rightTokens, StringComparer.OrdinalIgnoreCase).Count();
        return union == 0 ? 0m : decimal.Divide(overlap, union);
    }

    public static string? NormalizePersonName(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return string.Join(' ', value
            .Trim()
            .ToLower(CultureInfo.InvariantCulture)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    public static string? NormalizeEmail(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? null
            : value.Trim().ToLower(CultureInfo.InvariantCulture);

    public static string? NormalizePhone(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? null
            : new string(value.Where(char.IsDigit).ToArray());

    public static string? NormalizePostcode(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? null
            : value.Replace(" ", "", StringComparison.Ordinal).ToUpper(CultureInfo.InvariantCulture);

    public static DateOnly? TryParseUkDate(string? value) =>
        DateOnly.TryParseExact(value, "dd/MM/yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed
            : null;

    public static string? NormalizeStatus(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;

        var normalized = value.Trim();
        return normalized.StartsWith("cancel", StringComparison.OrdinalIgnoreCase)
            ? "cancelled"
            : normalized;
    }

    public static AddressParts SplitAddress(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return new AddressParts(null, null, null);
        var parts = value.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        return new AddressParts(
            parts.ElementAtOrDefault(0),
            parts.Length > 1 ? parts.ElementAtOrDefault(parts.Length - 2) : null,
            parts.Length > 2 ? parts.ElementAtOrDefault(parts.Length - 1) : null);
    }
}

internal static class PaymentsenseExtractor
{
    public static async Task<PaymentsenseAuthStatusResponse> GetAuthenticationStatusAsync()
    {
        var stdout = await RunExtractorAsync("paymentsense-auth-status.cjs", "status", "mode");
        return JsonSerializer.Deserialize<PaymentsenseAuthStatusResponse>(stdout, JsonDefaults.Options)
            ?? throw new InvalidOperationException("Paymentsense auth status check returned no data.");
    }

    public static async Task<LiveCustomerExtraction> ExtractCustomersAsync(string query)
    {
        var stdout = await RunExtractorAsync("paymentsense-live-customers.cjs", query);
        return JsonSerializer.Deserialize<LiveCustomerExtraction>(stdout, JsonDefaults.Options)
            ?? throw new InvalidOperationException("Paymentsense customer extraction returned no data.");
    }

    public static async Task<LiveProspectExtraction> ExtractProspectsAsync(string query)
    {
        var stdout = await RunExtractorAsync("paymentsense-live-prospects.cjs", query);
        return JsonSerializer.Deserialize<LiveProspectExtraction>(stdout, JsonDefaults.Options)
            ?? throw new InvalidOperationException("Paymentsense prospect extraction returned no data.");
    }

    public static async Task<LiveProspectDetail> ExtractProspectDetailAsync(string prospectId)
    {
        var stdout = await RunExtractorAsync("paymentsense-prospect-detail.cjs", prospectId, "prospect-id");
        return JsonSerializer.Deserialize<LiveProspectDetail>(stdout, JsonDefaults.Options)
            ?? throw new InvalidOperationException("Paymentsense prospect detail extraction returned no data.");
    }

    private static Task<string> RunExtractorAsync(string scriptName, string query) =>
        RunExtractorAsync(scriptName, query, "query");

    private static async Task<string> RunExtractorAsync(string scriptName, string value, string argumentName)
    {
        var scriptPath = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "scripts", scriptName);
        scriptPath = Path.GetFullPath(scriptPath);
        var authPath = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "playwright", ".auth", "paymentsense.json");
        authPath = Path.GetFullPath(authPath);

        if (!File.Exists(scriptPath))
        {
            throw new FileNotFoundException("Could not find Paymentsense extractor script.", scriptPath);
        }

        if (!File.Exists(authPath))
        {
            throw new FileNotFoundException("Could not find saved Paymentsense auth state. Run npm run auth:paymentsense first.", authPath);
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = "node",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            WorkingDirectory = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."))
        };
        startInfo.ArgumentList.Add(scriptPath);
        startInfo.ArgumentList.Add($"--{argumentName}");
        startInfo.ArgumentList.Add(value);
        startInfo.ArgumentList.Add("--auth");
        startInfo.ArgumentList.Add(authPath);

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("Could not start Paymentsense extractor.");
        var stdoutTask = process.StandardOutput.ReadToEndAsync();
        var stderrTask = process.StandardError.ReadToEndAsync();

        await process.WaitForExitAsync();

        var stdout = await stdoutTask;
        var stderr = await stderrTask;
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"Paymentsense extraction failed: {stderr}");
        }

        return stdout;
    }
}

internal sealed record AddressParts(string? Line1, string? Town, string? County);

internal sealed record HealthResponse(string Status, DateTime DatabaseTime);
internal sealed record DashboardResponse(
    long SearchRuns,
    long ExtractedRecords,
    long Organisations,
    long Prospects,
    long Customers,
    long CandidateMatches,
    long NeedsReviewMatches);
internal sealed record ActivityEventResponse(long Id, string EventType, string EntityType, long? EntityId, string Title, string Description, long? ActorUserId, string? ActorName, DateTime CreatedAt, bool IsNotifiable);
internal sealed record ActivityEventCreateRequest(string EventType, string EntityType, long? EntityId, long? ActorUserId, string? ActorName, string Title, string Description, bool IsNotifiable, IReadOnlyDictionary<string, object?>? Metadata = null);
internal sealed record ActivityActorContext(long? UserId, string? Name);
internal sealed record SearchRunResponse(long Id, string QueryText, string? SourceUrl, DateTime ExecutedAt, DateTime? CompletedAt, string CountsJson, string? Notes);
internal sealed record GeminiSettingResponse(string? ApiKey);
internal sealed record GeminiSettingUpdateRequest(string? ApiKey);
internal sealed record AiCompanyInsightResponse(long Id, string SearchName, string? SearchLocation, string CompanyName, string CompanyNumber, string? Status, JsonElement Insight, long? CreatedByUserId, string? CreatedByUserName, DateTime CreatedAt, DateTime UpdatedAt);
internal sealed record QueueMetricsResponse(string QueueName, bool Available, int ReadyCount, int UnackedCount, int ConsumerCount, string? Error);
internal sealed record QueuedJobSummaryResponse(long Total, long Pending, long Queued, long Running, long Completed, long Failed, long CancelRequested, long Cancelled);
internal sealed record JobOverviewResponse(QueuedJobSummaryResponse Summary, QueueMetricsResponse Queue);
internal sealed record QueuedJobResponse(
    long Id,
    string JobType,
    string DisplayName,
    string Status,
    JsonElement Payload,
    JsonElement? Result,
    long? RequestedByUserId,
    string? RequestedByUserName,
    DateTime ScheduledFor,
    DateTime? QueuedAt,
    DateTime? StartedAt,
    DateTime? CompletedAt,
    DateTime? LastHeartbeatAt,
    int AttemptCount,
    int MaxAttempts,
    bool CancelRequested,
    string? CurrentStep,
    string? ErrorText,
    DateTime? RemovedAt,
    long? RemovedByUserId,
    string? RemovedByUserName,
    DateTime CreatedAt,
    DateTime UpdatedAt);
internal sealed record AiInsightDigitalLinkResponse(string Label, string Url);
internal sealed record CustomerAiInsightSummaryResponse(long Id, string SearchName, string? SearchLocation, string CompanyName, string CompanyNumber, string? Status, string? RegisteredAddress, string? IncorporationDate, string? NatureOfBusiness, string? Turnover, string? EmployeeCount, string? Website, IReadOnlyList<AiInsightDigitalLinkResponse> DigitalLinks, DateTime UpdatedAt);
internal sealed record SaveAiCompanyInsightRequest(string SearchName, string? SearchLocation, JsonElement Insight, long? CustomerId = null);
internal sealed record CreateAiCompanyInsightJobRequest(string SearchName, string? SearchLocation, string? ScheduledFor, long? CustomerId = null, bool SaveToDatabase = true);
internal sealed record AiCompanyInsightJobPayload(string SearchName, string? SearchLocation, long? CustomerId, bool SaveToDatabase);
internal sealed record PaymentsenseAuthStatusResponse(bool Authenticated, string Url, string Title);
internal sealed record ProspectResponse(long Id, string ProspectId, string BusinessName, DateTime AddedAt, DateOnly? CreatedOn, string? OwnerName, bool? HasPaymentsenseCustomerMatch, string? ContactName, string? ContactEmail, string? Postcode, string? Channel, string? Origin, string? AddressLine1, string? Town, string? County, string? ContactPhone, bool HasStoredDetail, bool HasLead);
internal sealed record CustomerResponse(long Id, string CustomerKind, string? CustomerRef, string? Mid, DateTime AddedAt, string EntityName, string? TradingName, string? TradingAddress, string? Postcode, DateOnly? StartDate, string? Status, string? SuppressionReason, long? RegionId, string? RegionName, long? CustomerActivityStatusId, string? CustomerActivityStatusName, long? CustomerValueTypeId, string? CustomerValueTypeLabel, decimal? CustomerValueTypeDecimalValue, int? CustomerValueTypeShieldOrder, string? CustomerValueTypeImageFileName, long? AssignedUserId, string? AssignedUserName, bool IsBookmarked, bool HasAnyBookmark, bool HasNotes, bool HasOwnedChecklistMatch, bool HasStoredMatches, int AttachedProspectCount, bool HasLead, bool HasAiInsight, bool HasAiInsightJobScheduled);
internal sealed record CustomerSearchRequest(string Query, bool PersistToDatabase = true, long? RegionId = null);
internal sealed record ProspectSearchRequest(string Query, bool PersistToDatabase = true);
internal sealed record CustomerSearchPreviewResponse(string Query, string SearchUrl, IReadOnlyList<CustomerSearchRowResponse> Rows);
internal sealed record CustomerSearchRowResponse(string? CustomerRef, string Entity, string? Mid, string? TradingName, string? TradingAddress, string? Town, string? County, string? TradingPostcode, DateOnly? StartDate, string? Status, string? SourceUrl, bool Added);
internal sealed record ProspectSearchPreviewResponse(
    string Query,
    string SearchUrl,
    IReadOnlyList<ProspectSearchRowResponse> Rows,
    bool SavedSearchUsed,
    DateTime? CachedAt,
    DateTime? ExpiresAt);
internal sealed record ProspectSearchRowResponse(string ProspectId, string BusinessName, string? ContactName, string? ContactEmail, DateOnly? CreatedOn, string? OwnerName, string? SourceUrl, string? Postcode, bool HasStoredDetail, bool Added);
internal sealed record CustomerSearchRowInsertRequest(string? CustomerRef, string Entity, string? Mid, string? TradingName, string? TradingAddress, string? TradingPostcode, string? StartDate, string? Status, string? SourceUrl, long? RegionId = null);
internal sealed record ProspectSearchRowInsertRequest(string ProspectId, string? BusinessName, string? ContactName, string? ContactEmail, string? CreatedOn, string? OwnerName, string? SourceUrl, ProspectDetailInsertRequest? Detail);
internal sealed record MatchCandidateResponse(long Id, decimal Score, string Status, string ReasonsJson, string ProspectId, string ProspectName, string? CustomerRef, string? Mid, string CustomerName, DateTime GeneratedAt);
internal sealed record CustomerMatchResponse(long CustomerId, bool GeneratedNow, IReadOnlyList<CustomerProspectMatchResponse> Matches, LeadSummaryResponse? Lead, string? SuppressionReason, CustomerCommercialsResponse? Commercials, IReadOnlyList<CustomerBusinessTypeResponse> BusinessTypes, CustomerAiInsightSummaryResponse? AiInsight);
internal sealed record CustomerBusinessTypeOptionResponse(string Key, string Name, string? SicCode, string? Description, string Source);
internal sealed record CustomerBusinessTypeResponse(string Key, string Name, string? SicCode, string? Description, string Source);
internal sealed record CustomerProspectMatchResponse(long MatchId, string ProspectId, string BusinessName, string? ContactName, string? ContactEmail, string? OwnerName, string? AddressLine1, string? Postcode, decimal Score, string Status, string[] Reasons, bool GeneratedNow, bool HasStoredDetail);
internal sealed record CustomerMatchSource(long CustomerId, long OrganisationId, string EntityName, string? NormalizedEntityName, string? TradingName, string? NormalizedTradingName, string? TradingAddressLine1, string? NormalizedPostcode, string? SuppressionReason);
internal sealed record CustomerActivitySummary(long Id, string? CustomerRef, string? Mid, string EntityName, string? SuppressionReason, long? AssignedUserId);
internal sealed record CustomerNoteResponse(long Id, string NoteText, DateTime CreatedAt, long? CreatedByUserId, string? CreatedByUserName);
internal sealed record OwnedChecklistMatchResponse(long Id, string BusinessName, string? ContactName, string? ContactEmail, string OwnerName, DateTime CreatedAt, DateTime ExpiresAt, string Reason);
internal sealed record CustomerNoteCreateRequest(string NoteText, string? CreatedAt);
internal sealed record CustomerRegionAssignmentItem(long CustomerId, long? RegionId);
internal sealed record CustomerRegionAssignmentsUpdateRequest(IReadOnlyList<CustomerRegionAssignmentItem>? Assignments);
internal sealed record CustomerRegionAssignmentResult(long CustomerId, long? PreviousRegionId, string? PreviousRegionName, long? RegionId, string? RegionName);
internal sealed record CustomerBusinessTypeSelectionUpdateRequest(IReadOnlyList<string>? Keys);
internal sealed record CustomerBusinessTypeLinkSelection(long? BusinessTypeId, string? SicCode);
internal sealed record CustomerBusinessTypeSelectionParseResult(bool Success, IReadOnlyList<CustomerBusinessTypeLinkSelection> Selections, string? ErrorMessage);
internal sealed record ProspectActivitySummary(long Id, string ProspectId, string BusinessName);
internal sealed record LeadActivitySummary(long Id, long CustomerId, string CustomerName, string? CustomerRef, string? Mid, string LeadStatus, string LeadPriority, long? AssignedUserId, string? AssignedUserName);
internal sealed record MatchActivitySummary(long MatchId, long CustomerId, string? CustomerRef, string? Mid, string CustomerName, string ProspectId, string ProspectName);
internal sealed record CampaignWaveActivitySummary(long Id, string CampaignName, string Name, int WaveNumber);
internal sealed record CustomerAssignedUserUpdateRequest(long? AssignedUserId);
internal sealed record CustomerActivityStatusAssignmentUpdateRequest(long? CustomerActivityStatusId);
internal sealed record CustomerValueTypeResponse(long Id, int ShieldOrder, string ShieldKey, string ImageFileName, string? Label, decimal? DecimalValue, DateTime CreatedAt, DateTime UpdatedAt);
internal sealed record CustomerValueTypeUpdateRequest(string? Label, decimal? DecimalValue);
internal sealed class CustomerSuppressionUpdateRequest
{
    public string? SuppressionReason { get; init; }
    public bool UpdateSuppression { get; init; } = true;
    public decimal? CreditCardValue { get; init; }
    public string? ValuePeriod { get; init; }
    public decimal? CurrentChargePercent { get; init; }
    public decimal? ProposedChargePercent { get; init; }
    public bool UpdateCustomerValueType { get; init; }
    public long? CustomerValueTypeId { get; init; }
}
internal sealed record CustomerCommercialsResponse(decimal? CreditCardValue, string? ValuePeriod, decimal? CurrentChargePercent, decimal? ProposedChargePercent, decimal? CurrentChargeAmount, decimal? ProposedChargeAmount, decimal? DifferenceAmount, long? CustomerValueTypeId, string? CustomerValueTypeLabel, decimal? CustomerValueTypeDecimalValue, int? CustomerValueTypeShieldOrder, string? CustomerValueTypeImageFileName);
internal sealed record CustomerCommercialsUpdateRequest(decimal? CreditCardValue, string? ValuePeriod, decimal? CurrentChargePercent, decimal? ProposedChargePercent, long? CustomerValueTypeId);
internal sealed record GeneratedCustomerMatch(long ProspectDbId, string ProspectId, string BusinessName, string? ContactName, string? ContactEmail, string? AddressLine1, string? Postcode, decimal Score, string Status, IReadOnlyList<string> Reasons);
internal sealed record MatchEvaluation(bool Include, decimal Score, string Status, IReadOnlyList<string> Reasons);
internal sealed record LeadSummaryResponse(long Id, long CustomerId, string LeadStatus, DateTime CreatedAt);
internal sealed record LeadResponse(long Id, long CustomerId, string LeadStatus, string LeadPriority, long? AssignedUserId, string? AssignedUserName, DateTime CreatedAt, string? CustomerRef, string? Mid, string CustomerName, string? TradingName, string? TradingAddress, string? Postcode, string? ContactPhone, string? ContactEmail, long ProspectCount, long ContactHistoryCount, IReadOnlyList<LeadProspectResponse> Prospects);
internal sealed class LeadDetailResponse
{
    public long Id { get; init; }
    public long CustomerId { get; init; }
    public string LeadStatus { get; init; } = "";
    public string LeadPriority { get; init; } = "medium";
    public long? AssignedUserId { get; init; }
    public string? AssignedUserName { get; init; }
    public DateTime CreatedAt { get; init; }
    public string? CustomerRef { get; init; }
    public string? Mid { get; init; }
    public string CustomerName { get; init; } = "";
    public string? TradingName { get; init; }
    public string? TradingAddress { get; init; }
    public string? Postcode { get; init; }
    public string? ContactPhone { get; init; }
    public string? ContactEmail { get; init; }
    public CustomerCommercialsResponse? Commercials { get; init; }
    public IReadOnlyList<LeadProspectResponse> Prospects { get; init; } = [];
    public IReadOnlyList<LeadContactHistoryResponse> ContactHistory { get; init; } = [];
    public IReadOnlyList<LeadNoteResponse> Notes { get; init; } = [];
}
internal sealed record LeadProspectResponse(string ProspectId, string BusinessName, string? ContactName, string? ContactEmail, string? OwnerName, string? AddressLine1, string? Postcode, bool IsPrimary);
internal sealed record LeadContactHistoryResponse(long Id, string Channel, DateTime ContactedAt, string? Outcome, string? Notes, string? Reason, string? WhoBy, string? ResponseStatus);
internal sealed record LeadContactHistoryCreateRequest(string Channel, string? ContactedAt, string? Reason, string? WhoBy, string? ResponseStatus, string? Notes);
internal sealed record LeadNoteResponse(long Id, string NoteText, DateTime NotedAt, long? UserId, string? UserName);
internal sealed record LeadNoteCreateRequest(string NoteText, string? NotedAt, long? UserId);
internal sealed record LeadAssignedUserUpdateRequest(long? AssignedUserId);
internal sealed record LeadPriorityUpdateRequest(string LeadPriority);
internal sealed record LeadPrimaryProspectUpdateRequest(string ProspectId);
internal sealed record LeadStatusResponse(long Id, string Name, int SortOrder, DateTime CreatedAt, DateTime UpdatedAt);
internal sealed record LeadStatusCreateRequest(string Name, int? SortOrder);
internal sealed record LeadStatusUpdateEntityRequest(string Name, int? SortOrder);
internal sealed record CompanySicCodeResponse(string Code, string Description);
internal sealed record BusinessTypeResponse(long Id, string Name, string? SicCode, string? SicDescription, DateTime CreatedAt, DateTime UpdatedAt);
internal sealed record BusinessTypeCreateRequest(string Name, string? SicCode);
internal sealed record BusinessTypeUpdateRequest(string Name, string? SicCode);
internal sealed record CustomerActivityStatusResponse(long Id, string Name, int SortOrder, DateTime CreatedAt, DateTime UpdatedAt);
internal sealed record CustomerActivityStatusCreateRequest(string Name, int? SortOrder);
internal sealed record CustomerActivityStatusUpdateRequest(string Name, int? SortOrder);
internal sealed record RegionResponse(long Id, string Name, DateTime CreatedAt, DateTime UpdatedAt);
internal sealed record RegionCreateRequest(string Name);
internal sealed record RegionUpdateRequest(string Name);
internal sealed record UserResponse(long Id, string FullName, string Initials, string? Phone, string? Email, string? Color, DateTime CreatedAt);
internal sealed record UserCreateRequest(string FullName, string Initials, string? Phone, string? Email, string? Color);
internal sealed record UserColorUpdateRequest(string? Color);
internal sealed record GdprEntryResponse(long Id, string? EmailAddress, string? Name, string? Address, DateTime CreatedAt);
internal sealed record GdprCreateRequest(string? EmailAddress, string? Name, string? Address);
internal sealed record CampaignResponse(long Id, string Name, string? Description, string? Objective, DateOnly? StartDate, DateOnly? EndDate, string? TargetAudience, decimal? Budget, string? ProductService, string Status, DateTime CreatedAt, IReadOnlyList<CampaignWaveResponse> Waves);
internal sealed record CampaignWaveResponse(long Id, long CampaignId, string Name, int WaveNumber, string Channel, DateOnly? ScheduledDate, string Status, string? AssignedTeamOrUser, DateTime CreatedAt);
internal sealed record CampaignCreateRequest(string Name, string? Description, string? Objective, string? StartDate, string? EndDate, string? TargetAudience, string? Budget, string? ProductService, string? Status);
internal sealed record CampaignWaveCreateRequest(string Name, int WaveNumber, string? Channel, string? ScheduledDate, string? Status, string? AssignedTeamOrUser);
internal sealed record CampaignWaveLeadAssignRequest(IReadOnlyList<long> LeadIds);
internal enum ArchiveStatus { Success, NotFound, Blocked, Failed }
internal sealed record ArchiveOperationResult(ArchiveStatus Status, string? ErrorMessage = null)
{
    public static ArchiveOperationResult Success() => new(ArchiveStatus.Success);
    public static ArchiveOperationResult NotFound(string message) => new(ArchiveStatus.NotFound, message);
    public static ArchiveOperationResult Blocked(string message) => new(ArchiveStatus.Blocked, message);
    public static ArchiveOperationResult Failed(string message) => new(ArchiveStatus.Failed, message);
}
internal sealed record CustomerArchiveSnapshot(
    long SourceCustomerId,
    long SourceOrganisationId,
    string? CustomerRef,
    string? Mid,
    string CustomerKind,
    string? EntityName,
    string? TradingName,
    OrganisationArchiveSnapshot Organisation,
    IReadOnlyList<MatchCandidateArchiveSnapshot> Matches,
    DateOnly? StartDate,
    string? Status,
    string? SourceUrl,
    long? RawRecordId,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    RawRecordArchiveSnapshot? RawRecord);
internal sealed record ProspectArchiveSnapshot(
    long SourceProspectDbId,
    long SourceOrganisationId,
    string ProspectRef,
    string? BusinessName,
    OrganisationArchiveSnapshot Organisation,
    IReadOnlyList<MatchCandidateArchiveSnapshot> Matches,
    string? Channel,
    string? Origin,
    DateOnly? CreatedOn,
    string? OwnerName,
    string? SalesUrl,
    bool? HasPaymentsenseCustomerMatch,
    long? RawRecordId,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    RawRecordArchiveSnapshot? RawRecord,
    RawRecordArchiveSnapshot? LatestDetailRawRecord);
internal sealed record OrganisationArchiveSnapshot(
    long Id,
    string DisplayName,
    string NormalizedName,
    string? CompanyNumber,
    string Status,
    decimal? SourceConfidence,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    IReadOnlyList<AddressArchiveSnapshot> Addresses,
    IReadOnlyList<ContactArchiveSnapshot> Contacts,
    IReadOnlyList<ExternalReferenceArchiveSnapshot> ExternalReferences);
internal sealed record AddressArchiveSnapshot(
    long Id,
    string? Label,
    string? Line1,
    string? Line2,
    string? Town,
    string? County,
    string? Postcode,
    string? NormalizedPostcode,
    string? Country,
    decimal? SourceConfidence,
    DateTime CreatedAt,
    DateTime UpdatedAt);
internal sealed record ContactArchiveSnapshot(
    long Id,
    string? FullName,
    string? NormalizedName,
    string? Email,
    string? NormalizedEmail,
    string? Phone,
    string? NormalizedPhone,
    string? Role,
    decimal? SourceConfidence,
    DateTime CreatedAt,
    DateTime UpdatedAt);
internal sealed record ExternalReferenceArchiveSnapshot(
    long Id,
    string SourceSystem,
    string ReferenceType,
    string ReferenceValue,
    string? SourceUrl,
    DateTime FirstSeenAt,
    DateTime LastSeenAt,
    long? RawRecordId,
    RawRecordArchiveSnapshot? RawRecord);
internal sealed record MatchCandidateArchiveSnapshot(
    long Id,
    long? LinkedRecordId,
    string? LinkedReference,
    string? LinkedName,
    decimal Score,
    string MatchStatus,
    string ReasonsJson,
    string GeneratedBy,
    DateTime GeneratedAt,
    DateTime? ReviewedAt,
    string? ReviewedBy);
internal sealed record RawRecordArchiveSnapshot(
    long Id,
    long? SearchRunId,
    string SourceSystem,
    string RecordType,
    string? ExternalId,
    string? SourceUrl,
    DateTime ExtractedAt,
    string RawPayloadJson);
internal sealed record LiveCustomerExtraction(string Query, string SearchUrl, DateTime ExtractedAt, IReadOnlyList<LiveCustomerRow> Rows);
internal sealed record LiveCustomerRow(string? CustomerRef, string? Entity, string? Mid, string? TradingName, string? TradingAddress, string? TradingPostcode, string? StartDate, string? Status, string? SourceUrl);
internal sealed record LiveProspectExtraction(string Query, string SearchUrl, DateTime ExtractedAt, IReadOnlyList<LiveProspectRow> Rows);
internal sealed record LiveProspectRow(string? ProspectId, string? BusinessName, string? ContactName, string? ContactEmail, string? CreatedOn, string? OwnerName, string? SourceUrl);
internal sealed record LeadStatusUpdateRequest(string LeadStatus);
internal sealed record ProspectDetailInsertRequest(
    string? BusinessName,
    string? Channel,
    string? Origin,
    string? CreatedOn,
    bool? HasPaymentsenseCustomerMatch,
    ProspectAddressResponse Address,
    ProspectContactResponse Contact)
{
    public LiveProspectDetail ToLiveProspectDetail(string prospectId, string? sourceUrl) =>
        new(
            2,
            prospectId,
            BusinessName,
            sourceUrl ?? $"https://sales.paymentsense.com/prospect/{prospectId}",
            Channel,
            Origin,
            CreatedOn,
            HasPaymentsenseCustomerMatch,
            Address,
            Contact);
}
internal sealed record ProspectDetailResponse(
    string ProspectId,
    string BusinessName,
    string? Channel,
    string? Origin,
    DateOnly? CreatedOn,
    string? OwnerName,
    string? SalesUrl,
    bool? HasPaymentsenseCustomerMatch,
    ProspectAddressResponse Address,
    ProspectContactResponse Contact,
    bool ExtractedNow);
internal sealed record ProspectAddressResponse(string? Line1, string? Line2, string? Town, string? County, string? Postcode, string? Country);
internal sealed record ProspectContactResponse(string? Name, string? Phone, string? Email);
internal sealed record LiveProspectDetail(
    int? ExtractorVersion,
    string ProspectId,
    string? BusinessName,
    string SourceUrl,
    string? Channel,
    string? Origin,
    string? CreatedOn,
    bool? HasPaymentsenseCustomerMatch,
    ProspectAddressResponse Address,
    ProspectContactResponse Contact);

internal static class JsonDefaults
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
}
