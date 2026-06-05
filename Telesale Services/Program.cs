using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Npgsql;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

var connectionString =
    builder.Configuration.GetConnectionString("Postgres") ??
    Environment.GetEnvironmentVariable("DATABASE_URL");

if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException("Set ConnectionStrings:Postgres or DATABASE_URL before starting Telesale Services.");
}

var tokenSecret = Environment.GetEnvironmentVariable("TELESALE_SERVICES_TOKEN_SECRET");
if (string.IsNullOrWhiteSpace(tokenSecret))
{
    tokenSecret = "local-development-telesale-services-secret";
}

builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(connectionString));
builder.Services.AddSingleton(new TokenService(tokenSecret));
builder.Services.AddSingleton<RedisNotificationService>();
builder.Services.AddCors(options =>
{
    options.AddPolicy("TelesaleClients", policy => policy
        .SetIsOriginAllowed(origin => Uri.TryCreate(origin, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
        .AllowAnyHeader()
        .AllowAnyMethod());
});

var app = builder.Build();

app.UseCors("TelesaleClients");

app.MapGet("/health", async (NpgsqlDataSource db) =>
{
    await using var command = db.CreateCommand("select now()");
    var databaseTime = await command.ExecuteScalarAsync();
    return Results.Ok(new { status = "ok", service = "Telesale Services", databaseTime });
});

app.MapPost("/api/login", async (NpgsqlDataSource db, TokenService tokens, LoginRequest request) =>
{
    var login = NullIfBlank(request.Login);
    if (login is null || string.IsNullOrWhiteSpace(request.Password))
    {
        return Results.BadRequest(new { error = "Enter a login and password." });
    }

    var user = await LoadTelesaleUserForLoginAsync(db, login);
    if (user is null || user.PasswordHash is null || !VerifyPassword(request.Password, user.PasswordHash))
    {
        return Results.Unauthorized();
    }

    var expiresAt = DateTimeOffset.UtcNow.AddDays(3);
    var token = tokens.Create(user.Id, expiresAt);
    return Results.Ok(new LoginResponse(token, expiresAt, new TelesaleUserResponse(user.Id, user.FullName, user.Email)));
});

app.MapGet("/api/me", async (NpgsqlDataSource db, HttpRequest request, TokenService tokens) =>
{
    var auth = await AuthenticateAsync(db, request, tokens);
    return auth.ErrorResult ?? Results.Ok(auth.User);
});

app.MapGet("/api/events/stream", async (HttpContext httpContext, NpgsqlDataSource db, TokenService tokens, RedisNotificationService notifications) =>
{
    var token = httpContext.Request.Query["token"].ToString();
    var userId = tokens.Validate(token);
    if (userId is null || await LoadTelesaleUserByIdAsync(db, userId.Value) is null)
    {
        return Results.Unauthorized();
    }

    httpContext.Response.Headers.Append("Cache-Control", "no-cache");
    httpContext.Response.Headers.Append("X-Accel-Buffering", "no");
    httpContext.Response.ContentType = "text/event-stream";

    await WriteSseEventAsync(httpContext.Response, "status", new { available = notifications.IsAvailable }, httpContext.RequestAborted);
    if (!notifications.IsAvailable)
    {
        return Results.Empty;
    }

    await foreach (var activityEvent in notifications.SubscribeActivityEventsAsync(httpContext.RequestAborted))
    {
        await WriteSseEventAsync(httpContext.Response, "activity", activityEvent, httpContext.RequestAborted);
    }

    return Results.Empty;
});

app.MapGet("/api/waves", async (NpgsqlDataSource db, HttpRequest request, TokenService tokens) =>
{
    var auth = await AuthenticateAsync(db, request, tokens);
    if (auth.ErrorResult is not null)
    {
        return auth.ErrorResult;
    }

    var waves = await LoadAssignedWavesAsync(db, auth.User!.Id);
    return Results.Ok(waves);
});

app.MapGet("/api/waves/{exportId:long}", async (NpgsqlDataSource db, HttpRequest request, TokenService tokens, long exportId) =>
{
    var auth = await AuthenticateAsync(db, request, tokens);
    if (auth.ErrorResult is not null)
    {
        return auth.ErrorResult;
    }

    var wave = await LoadAssignedWaveAsync(db, auth.User!.Id, exportId);
    return wave is null
        ? Results.NotFound(new { error = "Wave export was not found for this user." })
        : Results.Ok(wave);
});

app.MapGet("/api/waves/{exportId:long}/json", async (NpgsqlDataSource db, HttpRequest request, TokenService tokens, long exportId) =>
{
    var auth = await AuthenticateAsync(db, request, tokens);
    if (auth.ErrorResult is not null)
    {
        return auth.ErrorResult;
    }

    var json = await LoadAssignedWaveJsonAsync(db, auth.User!.Id, exportId);
    return json is null
        ? Results.NotFound(new { error = "Wave export was not found for this user." })
        : Results.Text(json, "application/json; charset=utf-8");
});

app.MapGet("/api/waves/{exportId:long}/leads/{leadId:long}/main-context", async (NpgsqlDataSource db, HttpRequest request, TokenService tokens, long exportId, long leadId) =>
{
    var auth = await AuthenticateAsync(db, request, tokens);
    if (auth.ErrorResult is not null)
    {
        return auth.ErrorResult;
    }

    if (!await IsExportAssignedToUserAsync(db, auth.User!.Id, exportId))
    {
        return Results.NotFound(new { error = "Wave export was not found for this user." });
    }

    return Results.Ok(await LoadMainAppLeadContextAsync(db, exportId, leadId));
});

app.MapGet("/api/waves/{exportId:long}/main-context-summary", async (NpgsqlDataSource db, HttpRequest request, TokenService tokens, long exportId) =>
{
    var auth = await AuthenticateAsync(db, request, tokens);
    if (auth.ErrorResult is not null)
    {
        return auth.ErrorResult;
    }

    if (!await IsExportAssignedToUserAsync(db, auth.User!.Id, exportId))
    {
        return Results.NotFound(new { error = "Wave export was not found for this user." });
    }

    return Results.Ok(await LoadMainAppLeadContextSummaryAsync(db, exportId));
});

app.MapPost("/api/waves/{exportId:long}/instructions/{instructionId:long}/acknowledge", async (NpgsqlDataSource db, HttpRequest request, TokenService tokens, RedisNotificationService notifications, long exportId, long instructionId) =>
{
    var auth = await AuthenticateAsync(db, request, tokens);
    if (auth.ErrorResult is not null)
    {
        return auth.ErrorResult;
    }

    if (!await IsExportAssignedToUserAsync(db, auth.User!.Id, exportId))
    {
        return Results.NotFound(new { error = "Wave export was not found for this user." });
    }

    var acknowledged = await AcknowledgeInstructionAsync(db, auth.User!.Id, exportId, instructionId);
    if (acknowledged is not null)
    {
        var context = await LoadInstructionNotificationContextAsync(db, exportId, instructionId);
        await notifications.PublishActivityEventAsync(ActivityEventResponse.ForNotification(
            "lead.telesales_instruction.acknowledged",
            "lead",
            context?.LeadId,
            auth.User.Id,
            auth.User.FullName,
            $"Instruction acknowledged: {context?.LeadLabel ?? $"Lead #{context?.LeadId ?? 0}"}",
            $"{auth.User.FullName} acknowledged \"{ShortenText(context?.InstructionText ?? acknowledged.InstructionText, 90)}\"{FormatWaveContext(context)}."));
    }

    return acknowledged is null
        ? Results.NotFound(new { error = "Instruction was not found for this wave." })
        : Results.Ok(acknowledged);
});

app.MapPost("/api/waves/{exportId:long}/instructions/{instructionId:long}/replies", async (NpgsqlDataSource db, HttpRequest request, TokenService tokens, RedisNotificationService notifications, long exportId, long instructionId, TelesaleInstructionReplyCreateRequest reply) =>
{
    var auth = await AuthenticateAsync(db, request, tokens);
    if (auth.ErrorResult is not null)
    {
        return auth.ErrorResult;
    }

    var replyText = NullIfBlank(reply.ReplyText);
    if (replyText is null)
    {
        return Results.BadRequest(new { error = "Reply text is required." });
    }

    if (!await IsExportAssignedToUserAsync(db, auth.User!.Id, exportId))
    {
        return Results.NotFound(new { error = "Wave export was not found for this user." });
    }

    var created = await CreateInstructionReplyAsync(db, auth.User.Id, exportId, instructionId, replyText);
    if (created is not null)
    {
        var context = await LoadInstructionNotificationContextAsync(db, exportId, instructionId);
        await notifications.PublishActivityEventAsync(ActivityEventResponse.ForNotification(
            "lead.telesales_instruction.replied",
            "lead",
            context?.LeadId,
            auth.User.Id,
            auth.User.FullName,
            $"Telesales replied: {context?.LeadLabel ?? $"Lead #{context?.LeadId ?? 0}"}",
            $"{auth.User.FullName}: \"{ShortenText(replyText, 120)}\"{FormatWaveContext(context)}."));
    }

    return created is null
        ? Results.NotFound(new { error = "Instruction was not found for this wave." })
        : Results.Ok(created);
});

app.MapPost("/api/sync", async (NpgsqlDataSource db, HttpRequest request, TokenService tokens, RedisNotificationService notifications, TelesaleSyncRequest sync) =>
{
    var auth = await AuthenticateAsync(db, request, tokens);
    if (auth.ErrorResult is not null)
    {
        return auth.ErrorResult;
    }

    return await SaveSyncAsync(db, notifications, auth.User!, sync);
});

app.MapPost("/api/waves/{exportId:long}/sync", async (NpgsqlDataSource db, HttpRequest request, TokenService tokens, RedisNotificationService notifications, long exportId, TelesaleWaveSyncRequest sync) =>
{
    var auth = await AuthenticateAsync(db, request, tokens);
    if (auth.ErrorResult is not null)
    {
        return auth.ErrorResult;
    }

    return await SaveSyncAsync(db, notifications, auth.User!, new TelesaleSyncRequest(exportId, sync.LeadStates, sync.Interactions, sync.Followups));
});

app.MapGet("/api/campaign-waves/{waveId:long}/interaction-summary", async (NpgsqlDataSource db, long waveId) =>
{
    return Results.Ok(await LoadCampaignWaveInteractionSummaryAsync(db, waveId));
});

app.MapGet("/api/campaign-waves/{waveId:long}/leads/{leadId:long}/interactions", async (NpgsqlDataSource db, long waveId, long leadId) =>
{
    return Results.Ok(await LoadCampaignWaveLeadInteractionsAsync(db, waveId, leadId));
});

app.MapGet("/api/leads/{leadId:long}/interactions", async (NpgsqlDataSource db, long leadId) =>
{
    return Results.Ok(await LoadLeadInteractionsAsync(db, leadId));
});

app.Run();

static async Task<AuthResult> AuthenticateAsync(NpgsqlDataSource db, HttpRequest request, TokenService tokens)
{
    var header = request.Headers.Authorization.ToString();
    if (string.IsNullOrWhiteSpace(header) || !header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
    {
        return AuthResult.Unauthorized();
    }

    var token = header["Bearer ".Length..].Trim();
    var userId = tokens.Validate(token);
    if (userId is null)
    {
        return AuthResult.Unauthorized();
    }

    var user = await LoadTelesaleUserByIdAsync(db, userId.Value);
    return user is null
        ? AuthResult.Unauthorized()
        : AuthResult.Success(user);
}

static async Task<TelesaleUserRecord?> LoadTelesaleUserForLoginAsync(NpgsqlDataSource db, string login)
{
    await using var command = db.CreateCommand("""
        select id, full_name, email, password_hash
        from paymentsense_core.users
        where user_type = 'Telesale'
          and lower(username) = lower(@login)
        order by id
        limit 1
        """);
    command.Parameters.AddWithValue("login", login);

    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    return new TelesaleUserRecord(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.IsDBNull(2) ? null : reader.GetString(2),
        reader.IsDBNull(3) ? null : reader.GetString(3));
}

static async Task<TelesaleUserResponse?> LoadTelesaleUserByIdAsync(NpgsqlDataSource db, long userId)
{
    await using var command = db.CreateCommand("""
        select id, full_name, email
        from paymentsense_core.users
        where id = @user_id
          and user_type = 'Telesale'
        """);
    command.Parameters.AddWithValue("user_id", userId);

    await using var reader = await command.ExecuteReaderAsync();
    return await reader.ReadAsync()
        ? new TelesaleUserResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2))
        : null;
}

static async Task<IReadOnlyList<TelesaleWaveSummaryResponse>> LoadAssignedWavesAsync(NpgsqlDataSource db, long userId)
{
    await using var command = db.CreateCommand("""
        select
          twe.id,
          twe.campaign_wave_id,
          c.id,
          c.name,
          cw.name,
          cw.wave_number,
          twe.lead_count,
          twe.created_at
        from paymentsense_core.telesale_wave_exports twe
        join paymentsense_core.telesale_wave_export_users tweu on tweu.export_id = twe.id
        join paymentsense_core.campaign_waves cw on cw.id = twe.campaign_wave_id
        join paymentsense_core.campaigns c on c.id = cw.campaign_id
        where tweu.user_id = @user_id
        order by twe.created_at desc, twe.id desc
        """);
    command.Parameters.AddWithValue("user_id", userId);

    var rows = new List<TelesaleWaveSummaryResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new TelesaleWaveSummaryResponse(
            reader.GetInt64(0),
            reader.GetInt64(1),
            reader.GetInt64(2),
            reader.GetString(3),
            reader.GetString(4),
            reader.GetInt32(5),
            reader.GetInt32(6),
            reader.GetDateTime(7)));
    }

    return rows;
}

static async Task<TelesaleWaveDetailResponse?> LoadAssignedWaveAsync(NpgsqlDataSource db, long userId, long exportId)
{
    await using var command = db.CreateCommand("""
        select
          twe.id,
          twe.campaign_wave_id,
          c.id,
          c.name,
          cw.name,
          cw.wave_number,
          twe.lead_count,
          twe.created_at,
          twe.export_json
        from paymentsense_core.telesale_wave_exports twe
        join paymentsense_core.telesale_wave_export_users tweu on tweu.export_id = twe.id
        join paymentsense_core.campaign_waves cw on cw.id = twe.campaign_wave_id
        join paymentsense_core.campaigns c on c.id = cw.campaign_id
        where tweu.user_id = @user_id
          and twe.id = @export_id
        """);
    command.Parameters.AddWithValue("user_id", userId);
    command.Parameters.AddWithValue("export_id", exportId);

    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    using var document = JsonDocument.Parse(reader.GetString(8));
    return new TelesaleWaveDetailResponse(
        reader.GetInt64(0),
        reader.GetInt64(1),
        reader.GetInt64(2),
        reader.GetString(3),
        reader.GetString(4),
        reader.GetInt32(5),
        reader.GetInt32(6),
        reader.GetDateTime(7),
        document.RootElement.Clone());
}

static async Task<string?> LoadAssignedWaveJsonAsync(NpgsqlDataSource db, long userId, long exportId)
{
    await using var command = db.CreateCommand("""
        select twe.export_json
        from paymentsense_core.telesale_wave_exports twe
        join paymentsense_core.telesale_wave_export_users tweu on tweu.export_id = twe.id
        where tweu.user_id = @user_id
          and twe.id = @export_id
        """);
    command.Parameters.AddWithValue("user_id", userId);
    command.Parameters.AddWithValue("export_id", exportId);
    var value = await command.ExecuteScalarAsync();
    return value as string;
}

static async Task<TelesaleMainLeadContextResponse> LoadMainAppLeadContextAsync(NpgsqlDataSource db, long exportId, long leadId)
{
    long? waveId = null;
    await using (var waveCommand = db.CreateCommand("""
        select campaign_wave_id
        from paymentsense_core.telesale_wave_exports
        where id = @export_id
        """))
    {
        waveCommand.Parameters.AddWithValue("export_id", exportId);
        var value = await waveCommand.ExecuteScalarAsync();
        waveId = value is long id ? id : null;
    }

    if (waveId is null)
    {
        return new TelesaleMainLeadContextResponse([], []);
    }

    var history = new List<TelesaleMainContactHistoryResponse>();
    await using (var historyCommand = db.CreateCommand("""
        select
          id,
          channel,
          contacted_at,
          outcome,
          notes,
          reason,
          who_by,
          response_status
        from paymentsense_core.lead_contact_history
        where lead_id = @lead_id
        order by contacted_at desc, id desc
        limit 50
        """))
    {
        historyCommand.Parameters.AddWithValue("lead_id", leadId);
        await using var reader = await historyCommand.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            history.Add(new TelesaleMainContactHistoryResponse(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetDateTime(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7)));
        }
    }

    var instructions = new List<TelesaleMainInstructionResponse>();
    await using (var instructionCommand = db.CreateCommand("""
        select
          i.id,
          i.instruction_text,
          i.priority,
          i.created_at,
          i.created_by_user_id,
          created_by.full_name,
          i.acknowledged_at,
          i.acknowledged_by_user_id,
          acknowledged_by.full_name
        from paymentsense_core.telesale_lead_instructions i
        left join paymentsense_core.users created_by on created_by.id = i.created_by_user_id
        left join paymentsense_core.users acknowledged_by on acknowledged_by.id = i.acknowledged_by_user_id
        where i.campaign_wave_id = @wave_id
          and i.lead_id = @lead_id
        order by i.created_at desc, i.id desc
        limit 50
        """))
    {
        instructionCommand.Parameters.AddWithValue("wave_id", waveId.Value);
        instructionCommand.Parameters.AddWithValue("lead_id", leadId);
        await using var reader = await instructionCommand.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            instructions.Add(new TelesaleMainInstructionResponse(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetDateTime(3),
                reader.IsDBNull(4) ? null : reader.GetInt64(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetDateTime(6),
                reader.IsDBNull(7) ? null : reader.GetInt64(7),
                reader.IsDBNull(8) ? null : reader.GetString(8),
                []));
        }
    }

    instructions = await AttachInstructionRepliesAsync(db, instructions);
    return new TelesaleMainLeadContextResponse(history, instructions);
}

static async Task<IReadOnlyList<TelesaleMainLeadContextSummaryResponse>> LoadMainAppLeadContextSummaryAsync(NpgsqlDataSource db, long exportId)
{
    await using var command = db.CreateCommand("""
        with export_context as (
          select
            campaign_wave_id,
            export_json::json as export_json
          from paymentsense_core.telesale_wave_exports
          where id = @export_id
        ),
        exported_leads as (
          select
            (lead_json->>'leadId')::bigint as lead_id,
            ec.campaign_wave_id
          from export_context ec
          cross join lateral json_array_elements(ec.export_json->'leads') lead_json
        ),
        history as (
          select
            h.lead_id,
            count(*)::int as contact_history_count,
            max(h.contacted_at) as latest_contact_history_at
          from paymentsense_core.lead_contact_history h
          join exported_leads el on el.lead_id = h.lead_id
          group by h.lead_id
        ),
        instructions as (
          select
            i.lead_id,
            count(*)::int as instruction_count,
            count(*) filter (where i.acknowledged_at is null)::int as unacknowledged_instruction_count,
            max(i.created_at) as latest_instruction_at
          from paymentsense_core.telesale_lead_instructions i
          join exported_leads el on el.campaign_wave_id = i.campaign_wave_id and el.lead_id = i.lead_id
          group by i.lead_id
        )
        select
          el.lead_id,
          coalesce(h.contact_history_count, 0) as contact_history_count,
          h.latest_contact_history_at,
          coalesce(i.instruction_count, 0) as instruction_count,
          coalesce(i.unacknowledged_instruction_count, 0) as unacknowledged_instruction_count,
          i.latest_instruction_at
        from exported_leads el
        left join history h on h.lead_id = el.lead_id
        left join instructions i on i.lead_id = el.lead_id
        where coalesce(h.contact_history_count, 0) > 0
           or coalesce(i.instruction_count, 0) > 0
        order by greatest(coalesce(h.latest_contact_history_at, '-infinity'::timestamptz), coalesce(i.latest_instruction_at, '-infinity'::timestamptz)) desc
        """);
    command.Parameters.AddWithValue("export_id", exportId);

    var rows = new List<TelesaleMainLeadContextSummaryResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new TelesaleMainLeadContextSummaryResponse(
            reader.GetInt64(0),
            reader.GetInt32(1),
            reader.IsDBNull(2) ? null : reader.GetDateTime(2),
            reader.GetInt32(3),
            reader.GetInt32(4),
            reader.IsDBNull(5) ? null : reader.GetDateTime(5)));
    }

    return rows;
}

static async Task<TelesaleMainInstructionResponse?> AcknowledgeInstructionAsync(NpgsqlDataSource db, long userId, long exportId, long instructionId)
{
    await using var command = db.CreateCommand("""
        with export_context as (
          select campaign_wave_id
          from paymentsense_core.telesale_wave_exports
          where id = @export_id
        ),
        updated as (
          update paymentsense_core.telesale_lead_instructions i
          set acknowledged_at = coalesce(i.acknowledged_at, now()),
              acknowledged_by_user_id = coalesce(i.acknowledged_by_user_id, @user_id)
          from export_context ec
          where i.id = @instruction_id
            and i.campaign_wave_id = ec.campaign_wave_id
          returning
            i.id,
            i.instruction_text,
            i.priority,
            i.created_at,
            i.created_by_user_id,
            i.acknowledged_at,
            i.acknowledged_by_user_id
        )
        select
          updated.id,
          updated.instruction_text,
          updated.priority,
          updated.created_at,
          updated.created_by_user_id,
          created_by.full_name,
          updated.acknowledged_at,
          updated.acknowledged_by_user_id,
          acknowledged_by.full_name
        from updated
        left join paymentsense_core.users created_by on created_by.id = updated.created_by_user_id
        left join paymentsense_core.users acknowledged_by on acknowledged_by.id = updated.acknowledged_by_user_id
        """);
    command.Parameters.AddWithValue("export_id", exportId);
    command.Parameters.AddWithValue("instruction_id", instructionId);
    command.Parameters.AddWithValue("user_id", userId);

    await using var reader = await command.ExecuteReaderAsync();
    var instruction = await reader.ReadAsync()
        ? new TelesaleMainInstructionResponse(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetDateTime(3),
            reader.IsDBNull(4) ? null : reader.GetInt64(4),
            reader.IsDBNull(5) ? null : reader.GetString(5),
            reader.IsDBNull(6) ? null : reader.GetDateTime(6),
            reader.IsDBNull(7) ? null : reader.GetInt64(7),
            reader.IsDBNull(8) ? null : reader.GetString(8),
            [])
        : null;

    return instruction is null
        ? null
        : (await AttachInstructionRepliesAsync(db, [instruction])).Single();
}

static async Task<TelesaleMainInstructionReplyResponse?> CreateInstructionReplyAsync(NpgsqlDataSource db, long userId, long exportId, long instructionId, string replyText)
{
    await using var command = db.CreateCommand("""
        with export_context as (
          select campaign_wave_id
          from paymentsense_core.telesale_wave_exports
          where id = @export_id
        ),
        target_instruction as (
          select i.id
          from paymentsense_core.telesale_lead_instructions i
          join export_context ec on ec.campaign_wave_id = i.campaign_wave_id
          where i.id = @instruction_id
        ),
        inserted as (
          insert into paymentsense_core.telesale_lead_instruction_replies (
            instruction_id,
            reply_text,
            created_by_user_id
          )
          select
            ti.id,
            @reply_text,
            @user_id
          from target_instruction ti
          returning id, instruction_id, reply_text, created_by_user_id, created_at
        )
        select
          inserted.id,
          inserted.instruction_id,
          inserted.reply_text,
          inserted.created_by_user_id,
          created_by.full_name,
          inserted.created_at
        from inserted
        left join paymentsense_core.users created_by on created_by.id = inserted.created_by_user_id
        """);
    command.Parameters.AddWithValue("export_id", exportId);
    command.Parameters.AddWithValue("instruction_id", instructionId);
    command.Parameters.AddWithValue("reply_text", replyText);
    command.Parameters.AddWithValue("user_id", userId);

    await using var reader = await command.ExecuteReaderAsync();
    return await reader.ReadAsync()
        ? new TelesaleMainInstructionReplyResponse(
            reader.GetInt64(0),
            reader.GetInt64(1),
            reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetInt64(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.GetDateTime(5))
        : null;
}

static async Task<TelesaleInstructionNotificationContext?> LoadInstructionNotificationContextAsync(NpgsqlDataSource db, long exportId, long instructionId)
{
    await using var command = db.CreateCommand("""
        select
          i.lead_id,
          i.instruction_text,
          cw.name as wave_name,
          c.name as campaign_name,
          coalesce(cust_org.display_name, quote.business_name, quote_detail.business_name, prospect_org.display_name, 'Lead #' || i.lead_id::text) as lead_label
        from paymentsense_core.telesale_lead_instructions i
        join paymentsense_core.telesale_wave_exports twe on twe.campaign_wave_id = i.campaign_wave_id
        join paymentsense_core.campaign_waves cw on cw.id = i.campaign_wave_id
        join paymentsense_core.campaigns c on c.id = cw.campaign_id
        join paymentsense_core.leads l on l.id = i.lead_id
        left join paymentsense_core.customers cust on cust.id = l.customer_id
        left join paymentsense_core.organisations cust_org on cust_org.id = cust.organisation_id
        left join paymentsense_core.sales_quotes quote on quote.quote_id = l.source_quote_id
        left join paymentsense_core.sales_quote_prospect_details quote_detail on quote_detail.prospect_id = quote.prospect_id
        left join lateral (
          select po.display_name
          from paymentsense_core.lead_prospects lp
          join paymentsense_core.prospects p on p.id = lp.prospect_id
          join paymentsense_core.organisations po on po.id = p.organisation_id
          where lp.lead_id = l.id
          order by lp.is_primary desc, p.prospect_id
          limit 1
        ) prospect_org on true
        where twe.id = @export_id
          and i.id = @instruction_id
        limit 1
        """);
    command.Parameters.AddWithValue("export_id", exportId);
    command.Parameters.AddWithValue("instruction_id", instructionId);

    await using var reader = await command.ExecuteReaderAsync();
    return await reader.ReadAsync()
        ? new TelesaleInstructionNotificationContext(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetString(4))
        : null;
}

static string ShortenText(string text, int maxLength)
{
    var trimmed = text.Trim();
    return trimmed.Length <= maxLength ? trimmed : $"{trimmed[..Math.Max(0, maxLength - 3)]}...";
}

static string FormatWaveContext(TelesaleInstructionNotificationContext? context) =>
    context is null ? "" : $" on {context.CampaignName} / {context.WaveName}.";

static string FormatSyncWaveContext(TelesaleSyncNotificationContext? context) =>
    context is null ? "" : $" on {context.CampaignName ?? "Campaign"} / {context.WaveName ?? "Wave"}";

static async Task<List<TelesaleMainInstructionResponse>> AttachInstructionRepliesAsync(NpgsqlDataSource db, List<TelesaleMainInstructionResponse> instructions)
{
    if (instructions.Count == 0)
    {
        return instructions;
    }

    var instructionIds = instructions.Select(instruction => instruction.Id).ToArray();
    var repliesByInstructionId = new Dictionary<long, List<TelesaleMainInstructionReplyResponse>>();
    await using var command = db.CreateCommand("""
        select
          r.id,
          r.instruction_id,
          r.reply_text,
          r.created_by_user_id,
          created_by.full_name,
          r.created_at
        from paymentsense_core.telesale_lead_instruction_replies r
        left join paymentsense_core.users created_by on created_by.id = r.created_by_user_id
        where r.instruction_id = any(@instruction_ids)
        order by r.instruction_id, r.created_at, r.id
        """);
    command.Parameters.AddWithValue("instruction_ids", instructionIds);

    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        var instructionId = reader.GetInt64(1);
        if (!repliesByInstructionId.TryGetValue(instructionId, out var replies))
        {
            replies = [];
            repliesByInstructionId[instructionId] = replies;
        }

        replies.Add(new TelesaleMainInstructionReplyResponse(
            reader.GetInt64(0),
            instructionId,
            reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetInt64(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.GetDateTime(5)));
    }

    return instructions
        .Select(instruction => instruction with
        {
            Replies = repliesByInstructionId.TryGetValue(instruction.Id, out var replies)
                ? replies
                : []
        })
        .ToList();
}

static async Task<IResult> SaveSyncAsync(NpgsqlDataSource db, RedisNotificationService notifications, TelesaleUserResponse user, TelesaleSyncRequest sync)
{
    if (sync.ExportId <= 0)
    {
        return Results.BadRequest(new { error = "exportId is required." });
    }

    if (!await IsExportAssignedToUserAsync(db, user.Id, sync.ExportId))
    {
        return Results.NotFound(new { error = "Wave export was not found for this user." });
    }

    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    var leadStateCount = 0;
    foreach (var state in sync.LeadStates ?? [])
    {
        if (state.LeadId <= 0)
        {
            continue;
        }

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            insert into paymentsense_core.telesale_lead_states (
              export_id,
              lead_id,
              telesale_user_id,
              priority,
              status,
              response_status,
              notes,
              is_interaction_complete,
              completion_reason
            )
            values (
              @export_id,
              @lead_id,
              @telesale_user_id,
              @priority,
              @status,
              @response_status,
              @notes,
              @is_interaction_complete,
              @completion_reason
            )
            on conflict (export_id, lead_id, telesale_user_id) do update
            set priority = excluded.priority,
                status = excluded.status,
                response_status = excluded.response_status,
                notes = excluded.notes,
                is_interaction_complete = excluded.is_interaction_complete,
                completion_reason = excluded.completion_reason,
                updated_at = now()
            """;
        command.Parameters.AddWithValue("export_id", sync.ExportId);
        command.Parameters.AddWithValue("lead_id", state.LeadId);
        command.Parameters.AddWithValue("telesale_user_id", user.Id);
        command.Parameters.AddWithValue("priority", (object?)NullIfBlank(state.Priority) ?? DBNull.Value);
        command.Parameters.AddWithValue("status", (object?)NullIfBlank(state.Status) ?? DBNull.Value);
        command.Parameters.AddWithValue("response_status", (object?)FormatJsonValue(state.ResponseStatus) ?? DBNull.Value);
        command.Parameters.AddWithValue("notes", (object?)NullIfBlank(state.Notes) ?? DBNull.Value);
        command.Parameters.AddWithValue("is_interaction_complete", state.IsInteractionComplete ?? false);
        command.Parameters.AddWithValue("completion_reason", (object?)NullIfBlank(state.CompletionReason) ?? DBNull.Value);
        await command.ExecuteNonQueryAsync();
        leadStateCount++;
    }

    var interactionCount = 0;
    foreach (var interaction in sync.Interactions ?? [])
    {
        if (interaction.LeadId <= 0)
        {
            continue;
        }

        var interactionType = NullIfBlank(interaction.Type) ?? "other";
        var interactedAt = interaction.Timestamp ?? DateTimeOffset.UtcNow;

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            insert into paymentsense_core.telesale_interactions (
              export_id,
              lead_id,
              telesale_user_id,
              client_interaction_id,
              interaction_type,
              outcome,
              notes,
              interacted_at
            )
            values (
              @export_id,
              @lead_id,
              @telesale_user_id,
              @client_interaction_id,
              @interaction_type,
              @outcome,
              @notes,
              @interacted_at
            )
            on conflict (export_id, lead_id, telesale_user_id, client_interaction_id) do update
            set interaction_type = excluded.interaction_type,
                outcome = excluded.outcome,
                notes = excluded.notes,
                interacted_at = excluded.interacted_at,
                updated_at = now()
            """;
        command.Parameters.AddWithValue("export_id", sync.ExportId);
        command.Parameters.AddWithValue("lead_id", interaction.LeadId);
        command.Parameters.AddWithValue("telesale_user_id", user.Id);
        command.Parameters.AddWithValue("client_interaction_id", (object?)interaction.Id ?? DBNull.Value);
        command.Parameters.AddWithValue("interaction_type", interactionType);
        command.Parameters.AddWithValue("outcome", (object?)NullIfBlank(interaction.Outcome) ?? DBNull.Value);
        command.Parameters.AddWithValue("notes", (object?)NullIfBlank(interaction.Notes) ?? DBNull.Value);
        command.Parameters.AddWithValue("interacted_at", interactedAt);
        await command.ExecuteNonQueryAsync();
        interactionCount++;
    }

    var followUpCount = 0;
    foreach (var followUp in sync.Followups ?? [])
    {
        if (followUp.LeadId <= 0)
        {
            continue;
        }

        var scheduledAt = followUp.ScheduledTime ?? DateTimeOffset.UtcNow;
        var completed = followUp.Completed ?? false;

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            insert into paymentsense_core.telesale_followups (
              export_id,
              lead_id,
              telesale_user_id,
              client_followup_id,
              scheduled_at,
              notes,
              completed,
              completed_at
            )
            values (
              @export_id,
              @lead_id,
              @telesale_user_id,
              @client_followup_id,
              @scheduled_at,
              @notes,
              @completed,
              @completed_at
            )
            on conflict (export_id, lead_id, telesale_user_id, client_followup_id) do update
            set scheduled_at = excluded.scheduled_at,
                notes = excluded.notes,
                completed = excluded.completed,
                completed_at = excluded.completed_at,
                updated_at = now()
            """;
        command.Parameters.AddWithValue("export_id", sync.ExportId);
        command.Parameters.AddWithValue("lead_id", followUp.LeadId);
        command.Parameters.AddWithValue("telesale_user_id", user.Id);
        command.Parameters.AddWithValue("client_followup_id", (object?)followUp.Id ?? DBNull.Value);
        command.Parameters.AddWithValue("scheduled_at", scheduledAt);
        command.Parameters.AddWithValue("notes", (object?)NullIfBlank(followUp.Notes) ?? DBNull.Value);
        command.Parameters.AddWithValue("completed", completed);
        command.Parameters.AddWithValue("completed_at", completed ? DateTimeOffset.UtcNow : DBNull.Value);
        await command.ExecuteNonQueryAsync();
        followUpCount++;
    }

    await transaction.CommitAsync();

    var changedCount = leadStateCount + interactionCount + followUpCount;
    if (changedCount > 0)
    {
        var context = await LoadSyncNotificationContextAsync(db, sync.ExportId);
        await notifications.PublishActivityEventAsync(ActivityEventResponse.ForNotification(
            "telesales.sync.saved",
            "campaign_wave",
            context?.WaveId,
            user.Id,
            user.FullName,
            $"Telesales changes synced: {context?.WaveName ?? $"Export #{sync.ExportId}"}",
            $"{user.FullName} synced {leadStateCount} lead state{(leadStateCount == 1 ? "" : "s")}, {interactionCount} interaction{(interactionCount == 1 ? "" : "s")} and {followUpCount} follow-up{(followUpCount == 1 ? "" : "s")}{FormatSyncWaveContext(context)}.",
            false));
    }

    return Results.Ok(new TelesaleSyncResponse(sync.ExportId, leadStateCount, interactionCount, followUpCount));
}

static async Task<TelesaleSyncNotificationContext?> LoadSyncNotificationContextAsync(NpgsqlDataSource db, long exportId)
{
    await using var command = db.CreateCommand("""
        select
          twe.campaign_wave_id,
          cw.name as wave_name,
          c.name as campaign_name
        from paymentsense_core.telesale_wave_exports twe
        left join paymentsense_core.campaign_waves cw on cw.id = twe.campaign_wave_id
        left join paymentsense_core.campaigns c on c.id = cw.campaign_id
        where twe.id = @export_id
        """);
    command.Parameters.AddWithValue("export_id", exportId);
    await using var reader = await command.ExecuteReaderAsync();
    return await reader.ReadAsync()
        ? new TelesaleSyncNotificationContext(
            reader.GetInt64(0),
            reader.IsDBNull(1) ? null : reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2))
        : null;
}

static async Task<IReadOnlyList<TelesaleLeadInteractionSummaryResponse>> LoadCampaignWaveInteractionSummaryAsync(NpgsqlDataSource db, long waveId)
{
    await using var command = db.CreateCommand("""
        with activity as (
          select
            tls.lead_id,
            tls.telesale_user_id,
            tls.updated_at as activity_at
          from paymentsense_core.telesale_lead_states tls
          join paymentsense_core.telesale_wave_exports twe on twe.id = tls.export_id
          join lateral json_array_elements(twe.export_json::json->'leads') exported_lead on exported_lead->>'leadId' = tls.lead_id::text
          where twe.campaign_wave_id = @wave_id
            and (
              tls.is_interaction_complete
              or nullif(btrim(coalesce(tls.notes, '')), '') is not null
              or nullif(btrim(coalesce(tls.completion_reason, '')), '') is not null
              or nullif(btrim(coalesce(tls.response_status, '')), '') is not null
              or (
                tls.status is not null
                and tls.status is distinct from exported_lead->>'status'
              )
              or (
                tls.priority is not null
                and tls.priority is distinct from exported_lead->>'priority'
              )
            )

          union all

          select
            ti.lead_id,
            ti.telesale_user_id,
            greatest(ti.interacted_at, ti.updated_at) as activity_at
          from paymentsense_core.telesale_interactions ti
          join paymentsense_core.telesale_wave_exports twe on twe.id = ti.export_id
          where twe.campaign_wave_id = @wave_id

          union all

          select
            tf.lead_id,
            tf.telesale_user_id,
            tf.updated_at as activity_at
          from paymentsense_core.telesale_followups tf
          join paymentsense_core.telesale_wave_exports twe on twe.id = tf.export_id
          where twe.campaign_wave_id = @wave_id
        )
        select
          activity.lead_id,
          count(*)::int as interaction_count,
          max(activity.activity_at) as last_interaction_at,
          string_agg(distinct coalesce(u.username, u.full_name), ', ' order by coalesce(u.username, u.full_name)) as telesale_users
        from activity
        join paymentsense_core.users u on u.id = activity.telesale_user_id
        group by activity.lead_id
        order by activity.lead_id
        """);
    command.Parameters.AddWithValue("wave_id", waveId);

    var rows = new List<TelesaleLeadInteractionSummaryResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new TelesaleLeadInteractionSummaryResponse(
            reader.GetInt64(0),
            reader.GetInt32(1),
            reader.GetDateTime(2),
            reader.IsDBNull(3) ? null : reader.GetString(3)));
    }

    return rows;
}

static async Task<IReadOnlyList<TelesaleLeadInteractionDetailResponse>> LoadCampaignWaveLeadInteractionsAsync(NpgsqlDataSource db, long waveId, long leadId)
{
    await using var command = db.CreateCommand("""
        with lead_state_activity as (
          select
            tls.lead_id,
            tls.telesale_user_id,
            tls.updated_at as activity_at,
            'Lead update' as activity_type,
            case
              when tls.is_interaction_complete then 'Marked complete'
              when nullif(btrim(coalesce(tls.response_status, '')), '') is not null then 'Response status updated'
              when nullif(btrim(coalesce(tls.notes, '')), '') is not null then 'Notes updated'
              when nullif(btrim(coalesce(tls.completion_reason, '')), '') is not null then 'Completion reason updated'
              when tls.status is distinct from exported_lead->>'status' then 'Status changed'
              when tls.priority is distinct from exported_lead->>'priority' then 'Priority changed'
              else 'Lead updated'
            end as title,
            concat_ws(
              ' | ',
              case when tls.status is distinct from exported_lead->>'status' then 'Status: ' || coalesce(exported_lead->>'status', '') || ' to ' || coalesce(tls.status, '') end,
              case when tls.priority is distinct from exported_lead->>'priority' then 'Priority: ' || coalesce(exported_lead->>'priority', '') || ' to ' || coalesce(tls.priority, '') end,
              case when nullif(btrim(coalesce(tls.response_status, '')), '') is not null then 'Response: ' || tls.response_status end,
              case when tls.is_interaction_complete then 'Complete' end,
              case when nullif(btrim(coalesce(tls.completion_reason, '')), '') is not null then 'Reason: ' || tls.completion_reason end,
              case when nullif(btrim(coalesce(tls.notes, '')), '') is not null then tls.notes end
            ) as details
          from paymentsense_core.telesale_lead_states tls
          join paymentsense_core.telesale_wave_exports twe on twe.id = tls.export_id
          join lateral json_array_elements(twe.export_json::json->'leads') exported_lead on exported_lead->>'leadId' = tls.lead_id::text
          where twe.campaign_wave_id = @wave_id
            and tls.lead_id = @lead_id
            and (
              tls.is_interaction_complete
              or nullif(btrim(coalesce(tls.notes, '')), '') is not null
              or nullif(btrim(coalesce(tls.completion_reason, '')), '') is not null
              or nullif(btrim(coalesce(tls.response_status, '')), '') is not null
              or (
                tls.status is not null
                and tls.status is distinct from exported_lead->>'status'
              )
              or (
                tls.priority is not null
                and tls.priority is distinct from exported_lead->>'priority'
              )
            )
        ),
        activity as (
          select
            lead_id,
            telesale_user_id,
            activity_at,
            activity_type,
            title,
            details
          from lead_state_activity

          union all

          select
            ti.lead_id,
            ti.telesale_user_id,
            ti.interacted_at as activity_at,
            ti.interaction_type as activity_type,
            coalesce(nullif(btrim(ti.outcome), ''), ti.interaction_type) as title,
            ti.notes as details
          from paymentsense_core.telesale_interactions ti
          join paymentsense_core.telesale_wave_exports twe on twe.id = ti.export_id
          where twe.campaign_wave_id = @wave_id
            and ti.lead_id = @lead_id

          union all

          select
            tf.lead_id,
            tf.telesale_user_id,
            coalesce(tf.completed_at, tf.scheduled_at, tf.updated_at) as activity_at,
            'Follow-up' as activity_type,
            case when tf.completed then 'Follow-up completed' else 'Follow-up scheduled' end as title,
            tf.notes as details
          from paymentsense_core.telesale_followups tf
          join paymentsense_core.telesale_wave_exports twe on twe.id = tf.export_id
          where twe.campaign_wave_id = @wave_id
            and tf.lead_id = @lead_id
        )
        select
          activity.activity_at,
          activity.activity_type,
          activity.title,
          activity.details,
          coalesce(u.username, u.full_name) as telesale_user
        from activity
        join paymentsense_core.users u on u.id = activity.telesale_user_id
        order by activity.activity_at, activity.activity_type, activity.title
        """);
    command.Parameters.AddWithValue("wave_id", waveId);
    command.Parameters.AddWithValue("lead_id", leadId);

    var rows = new List<TelesaleLeadInteractionDetailResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new TelesaleLeadInteractionDetailResponse(
            reader.GetDateTime(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetString(4)));
    }

    return rows;
}

static async Task<IReadOnlyList<TelesaleLeadInteractionDetailResponse>> LoadLeadInteractionsAsync(NpgsqlDataSource db, long leadId)
{
    await using var command = db.CreateCommand("""
        with lead_state_activity as (
          select
            tls.lead_id,
            tls.telesale_user_id,
            tls.updated_at as activity_at,
            'Lead update' as activity_type,
            case
              when tls.is_interaction_complete then 'Marked complete'
              when nullif(btrim(coalesce(tls.response_status, '')), '') is not null then 'Response status updated'
              when nullif(btrim(coalesce(tls.notes, '')), '') is not null then 'Notes updated'
              when nullif(btrim(coalesce(tls.completion_reason, '')), '') is not null then 'Completion reason updated'
              when tls.status is distinct from exported_lead->>'status' then 'Status changed'
              when tls.priority is distinct from exported_lead->>'priority' then 'Priority changed'
              else 'Lead updated'
            end as title,
            concat_ws(
              ' | ',
              case when tls.status is distinct from exported_lead->>'status' then 'Status: ' || coalesce(exported_lead->>'status', '') || ' to ' || coalesce(tls.status, '') end,
              case when tls.priority is distinct from exported_lead->>'priority' then 'Priority: ' || coalesce(exported_lead->>'priority', '') || ' to ' || coalesce(tls.priority, '') end,
              case when nullif(btrim(coalesce(tls.response_status, '')), '') is not null then 'Response: ' || tls.response_status end,
              case when tls.is_interaction_complete then 'Complete' end,
              case when nullif(btrim(coalesce(tls.completion_reason, '')), '') is not null then 'Reason: ' || tls.completion_reason end,
              case when nullif(btrim(coalesce(tls.notes, '')), '') is not null then tls.notes end
            ) as details,
            c.name as campaign_name,
            cw.name as wave_name
          from paymentsense_core.telesale_lead_states tls
          join paymentsense_core.telesale_wave_exports twe on twe.id = tls.export_id
          join paymentsense_core.campaign_waves cw on cw.id = twe.campaign_wave_id
          join paymentsense_core.campaigns c on c.id = cw.campaign_id
          join lateral json_array_elements(twe.export_json::json->'leads') exported_lead on exported_lead->>'leadId' = tls.lead_id::text
          where tls.lead_id = @lead_id
            and (
              tls.is_interaction_complete
              or nullif(btrim(coalesce(tls.notes, '')), '') is not null
              or nullif(btrim(coalesce(tls.completion_reason, '')), '') is not null
              or nullif(btrim(coalesce(tls.response_status, '')), '') is not null
              or (
                tls.status is not null
                and tls.status is distinct from exported_lead->>'status'
              )
              or (
                tls.priority is not null
                and tls.priority is distinct from exported_lead->>'priority'
              )
            )
        ),
        activity as (
          select
            lead_id,
            telesale_user_id,
            activity_at,
            activity_type,
            title,
            details,
            campaign_name,
            wave_name
          from lead_state_activity

          union all

          select
            ti.lead_id,
            ti.telesale_user_id,
            ti.interacted_at as activity_at,
            ti.interaction_type as activity_type,
            coalesce(nullif(btrim(ti.outcome), ''), ti.interaction_type) as title,
            ti.notes as details,
            c.name as campaign_name,
            cw.name as wave_name
          from paymentsense_core.telesale_interactions ti
          join paymentsense_core.telesale_wave_exports twe on twe.id = ti.export_id
          join paymentsense_core.campaign_waves cw on cw.id = twe.campaign_wave_id
          join paymentsense_core.campaigns c on c.id = cw.campaign_id
          where ti.lead_id = @lead_id

          union all

          select
            tf.lead_id,
            tf.telesale_user_id,
            coalesce(tf.completed_at, tf.scheduled_at, tf.updated_at) as activity_at,
            'Follow-up' as activity_type,
            case when tf.completed then 'Follow-up completed' else 'Follow-up scheduled' end as title,
            tf.notes as details,
            c.name as campaign_name,
            cw.name as wave_name
          from paymentsense_core.telesale_followups tf
          join paymentsense_core.telesale_wave_exports twe on twe.id = tf.export_id
          join paymentsense_core.campaign_waves cw on cw.id = twe.campaign_wave_id
          join paymentsense_core.campaigns c on c.id = cw.campaign_id
          where tf.lead_id = @lead_id
        )
        select
          activity.activity_at,
          activity.activity_type,
          activity.title,
          activity.details,
          coalesce(u.username, u.full_name) as telesale_user,
          activity.campaign_name,
          activity.wave_name
        from activity
        join paymentsense_core.users u on u.id = activity.telesale_user_id
        order by activity.activity_at, activity.activity_type, activity.title
        """);
    command.Parameters.AddWithValue("lead_id", leadId);

    var rows = new List<TelesaleLeadInteractionDetailResponse>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new TelesaleLeadInteractionDetailResponse(
            reader.GetDateTime(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetString(5),
            reader.IsDBNull(6) ? null : reader.GetString(6)));
    }

    return rows;
}

static async Task<bool> IsExportAssignedToUserAsync(NpgsqlDataSource db, long userId, long exportId)
{
    await using var command = db.CreateCommand("""
        select exists (
          select 1
          from paymentsense_core.telesale_wave_export_users
          where export_id = @export_id
            and user_id = @user_id
        )
        """);
    command.Parameters.AddWithValue("export_id", exportId);
    command.Parameters.AddWithValue("user_id", userId);
    return await command.ExecuteScalarAsync() is true;
}

static string? NullIfBlank(string? value)
{
    var trimmed = value?.Trim();
    return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
}

static async Task WriteSseEventAsync(HttpResponse response, string eventName, object payload, CancellationToken cancellationToken)
{
    var json = JsonSerializer.Serialize(payload, JsonSerializerOptions.Web);
    await response.WriteAsync($"event: {eventName}\n", cancellationToken);
    await response.WriteAsync($"data: {json}\n\n", cancellationToken);
    await response.Body.FlushAsync(cancellationToken);
}

static string? FormatJsonValue(JsonElement? value)
{
    if (value is null || value.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
    {
        return null;
    }

    return value.Value.ValueKind == JsonValueKind.String
        ? value.Value.GetString()
        : value.Value.GetRawText();
}

static bool VerifyPassword(string password, string passwordHash)
{
    var parts = passwordHash.Split('$');
    if (parts.Length != 4 || parts[0] != "pbkdf2-sha256")
    {
        return false;
    }

    if (!int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var iterations))
    {
        return false;
    }

    try
    {
        var salt = Convert.FromBase64String(parts[2]);
        var expectedHash = Convert.FromBase64String(parts[3]);
        var actualHash = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expectedHash.Length);
        return CryptographicOperations.FixedTimeEquals(actualHash, expectedHash);
    }
    catch (FormatException)
    {
        return false;
    }
}

internal sealed class TokenService(string secret)
{
    private readonly byte[] secretBytes = Encoding.UTF8.GetBytes(secret);

    public string Create(long userId, DateTimeOffset expiresAt)
    {
        var payload = $"{userId}:{expiresAt.ToUnixTimeSeconds()}";
        var signature = Sign(payload);
        return Convert.ToBase64String(Encoding.UTF8.GetBytes($"{payload}:{signature}"));
    }

    public long? Validate(string token)
    {
        string decoded;
        try
        {
            decoded = Encoding.UTF8.GetString(Convert.FromBase64String(token));
        }
        catch (FormatException)
        {
            return null;
        }

        var parts = decoded.Split(':');
        if (parts.Length != 3 ||
            !long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var userId) ||
            !long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var expiresAtUnix))
        {
            return null;
        }

        var payload = $"{parts[0]}:{parts[1]}";
        if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(Sign(payload)), Encoding.UTF8.GetBytes(parts[2])))
        {
            return null;
        }

        return DateTimeOffset.UtcNow <= DateTimeOffset.FromUnixTimeSeconds(expiresAtUnix)
            ? userId
            : null;
    }

    private string Sign(string payload)
    {
        using var hmac = new HMACSHA256(secretBytes);
        return Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload)));
    }
}

internal sealed record LoginRequest(string? Login, string? Password);
internal sealed record LoginResponse(string Token, DateTimeOffset ExpiresAt, TelesaleUserResponse User);
internal sealed record TelesaleUserRecord(long Id, string FullName, string? Email, string? PasswordHash);
internal sealed record TelesaleUserResponse(long Id, string FullName, string? Email);
internal sealed record TelesaleWaveSummaryResponse(long ExportId, long WaveId, long CampaignId, string CampaignName, string WaveName, int WaveNumber, int LeadCount, DateTime SentAt);
internal sealed record TelesaleWaveDetailResponse(long ExportId, long WaveId, long CampaignId, string CampaignName, string WaveName, int WaveNumber, int LeadCount, DateTime SentAt, JsonElement ExportJson);
internal sealed record TelesaleSyncRequest(long ExportId, IReadOnlyList<TelesaleLeadStateSync>? LeadStates, IReadOnlyList<TelesaleInteractionSync>? Interactions, IReadOnlyList<TelesaleFollowUpSync>? Followups);
internal sealed record TelesaleWaveSyncRequest(IReadOnlyList<TelesaleLeadStateSync>? LeadStates, IReadOnlyList<TelesaleInteractionSync>? Interactions, IReadOnlyList<TelesaleFollowUpSync>? Followups);
internal sealed record TelesaleLeadStateSync(long LeadId, string? Priority, string? Status, JsonElement? ResponseStatus, string? Notes, bool? IsInteractionComplete, string? CompletionReason);
internal sealed record TelesaleInteractionSync(long? Id, long LeadId, DateTimeOffset? Timestamp, string? Outcome, string? Notes, string? Type);
internal sealed record TelesaleFollowUpSync(long? Id, long LeadId, DateTimeOffset? ScheduledTime, string? Notes, bool? Completed);
internal sealed record TelesaleSyncResponse(long ExportId, int LeadStateCount, int InteractionCount, int FollowUpCount);
internal sealed record TelesaleMainLeadContextResponse(IReadOnlyList<TelesaleMainContactHistoryResponse> ContactHistory, IReadOnlyList<TelesaleMainInstructionResponse> Instructions);
internal sealed record TelesaleMainLeadContextSummaryResponse(long LeadId, int ContactHistoryCount, DateTime? LatestContactHistoryAt, int InstructionCount, int UnacknowledgedInstructionCount, DateTime? LatestInstructionAt);
internal sealed record TelesaleMainContactHistoryResponse(long Id, string Channel, DateTime ContactedAt, string? Outcome, string? Notes, string? Reason, string? WhoBy, string? ResponseStatus);
internal sealed record TelesaleMainInstructionResponse(long Id, string InstructionText, string Priority, DateTime CreatedAt, long? CreatedByUserId, string? CreatedByUserName, DateTime? AcknowledgedAt, long? AcknowledgedByUserId, string? AcknowledgedByUserName, IReadOnlyList<TelesaleMainInstructionReplyResponse> Replies);
internal sealed record TelesaleMainInstructionReplyResponse(long Id, long InstructionId, string ReplyText, long? CreatedByUserId, string? CreatedByUserName, DateTime CreatedAt);
internal sealed record TelesaleInstructionReplyCreateRequest(string? ReplyText);
internal sealed record TelesaleInstructionNotificationContext(long LeadId, string InstructionText, string WaveName, string CampaignName, string LeadLabel);
internal sealed record TelesaleSyncNotificationContext(long WaveId, string? WaveName, string? CampaignName);
internal sealed record TelesaleLeadInteractionSummaryResponse(long LeadId, int InteractionCount, DateTime LastInteractionAt, string? TelesaleUsers);
internal sealed record TelesaleLeadInteractionDetailResponse(DateTime OccurredAt, string ActivityType, string Title, string? Details, string? TelesaleUser, string? CampaignName = null, string? WaveName = null);
internal sealed record ActivityEventResponse(long Id, string EventType, string EntityType, long? EntityId, string Title, string Description, long? ActorUserId, string? ActorName, DateTime CreatedAt, bool IsNotifiable)
{
    public static ActivityEventResponse ForNotification(string eventType, string entityType, long? entityId, long? actorUserId, string? actorName, string title, string description, bool isNotifiable = true) =>
        new(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), eventType, entityType, entityId, title, description, actorUserId, actorName, DateTime.UtcNow, isNotifiable);
}

internal sealed class RedisNotificationService(IConfiguration configuration, ILogger<RedisNotificationService> logger)
{
    private const string ActivityEventsChannel = "matchlab:activity-events";
    private readonly Lazy<Task<IConnectionMultiplexer?>> _connection = new(() => ConnectAsync(configuration, logger));

    public bool IsAvailable => !string.IsNullOrWhiteSpace(GetConnectionString(configuration));

    public async Task PublishActivityEventAsync(ActivityEventResponse activityEvent)
    {
        var connection = await GetConnectionAsync();
        if (connection is null) return;

        try
        {
            var payload = JsonSerializer.Serialize(activityEvent, JsonSerializerOptions.Web);
            await connection.GetSubscriber().PublishAsync(RedisChannel.Literal(ActivityEventsChannel), payload);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Could not publish Redis activity event {EventType}.", activityEvent.EventType);
        }
    }

    public async IAsyncEnumerable<ActivityEventResponse> SubscribeActivityEventsAsync([System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var connection = await GetConnectionAsync();
        if (connection is null) yield break;

        var channel = Channel.CreateUnbounded<ActivityEventResponse>();
        var subscriber = connection.GetSubscriber();
        Action<RedisChannel, RedisValue> handler = (_, value) =>
        {
            try
            {
                var activityEvent = JsonSerializer.Deserialize<ActivityEventResponse>(value.ToString(), JsonSerializerOptions.Web);
                if (activityEvent is not null)
                {
                    channel.Writer.TryWrite(activityEvent);
                }
            }
            catch (JsonException exception)
            {
                logger.LogWarning(exception, "Could not parse Redis activity event payload.");
            }
        };

        await subscriber.SubscribeAsync(RedisChannel.Literal(ActivityEventsChannel), handler);
        try
        {
            await foreach (var activityEvent in channel.Reader.ReadAllAsync(cancellationToken))
            {
                yield return activityEvent;
            }
        }
        finally
        {
            await subscriber.UnsubscribeAsync(RedisChannel.Literal(ActivityEventsChannel), handler);
            channel.Writer.TryComplete();
        }
    }

    private async Task<IConnectionMultiplexer?> GetConnectionAsync()
    {
        if (!IsAvailable) return null;
        return await _connection.Value;
    }

    private static async Task<IConnectionMultiplexer?> ConnectAsync(IConfiguration configuration, ILogger logger)
    {
        var connectionString = GetConnectionString(configuration);
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            logger.LogInformation("Redis notifications are disabled because Redis__ConnectionString is not set.");
            return null;
        }

        try
        {
            return await ConnectionMultiplexer.ConnectAsync(connectionString);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Redis notifications are disabled because Redis could not be reached.");
            return null;
        }
    }

    private static string? GetConnectionString(IConfiguration configuration) =>
        configuration["Redis:ConnectionString"] ?? Environment.GetEnvironmentVariable("REDIS_CONNECTION_STRING");
}

internal sealed record AuthResult(TelesaleUserResponse? User, IResult? ErrorResult)
{
    public static AuthResult Success(TelesaleUserResponse user) => new(user, null);
    public static AuthResult Unauthorized() => new(null, Results.Unauthorized());
}
