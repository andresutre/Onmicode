//! Token usage summed across every saved transcript, for the Usage page.
//!
//! Each user turn carries the provider's token accounting (`turnMetrics`) on
//! its block. Transcripts stay in Rust: the scan parses only the handful of
//! fields it needs from each `blocks_json` and returns per-day buckets keyed
//! by agent, model and project, so the web view never loads a transcript.

use std::collections::{BTreeMap, HashMap};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::session_store::SessionStore;

/// A year and a bit, which covers every period the page offers.
const MAX_DAYS: usize = 400;
/// Cheap pre-check: a transcript without this key has no usage to count.
/// Prose that mentions it is escaped (`\"turnMetrics\"`) and never matches.
const METRICS_KEY: &str = "\"turnMetrics\"";

/// Every summary column sits behind the transcript blob in the record, so
/// filtering on the table would walk each transcript's overflow pages. The
/// covering index answers the filter, and the table is read only for the
/// `blocks_json` of sessions active in the period.
const SCAN_SQL: &str = "SELECT harness, model, cwd, updated_at, blocks_json
     FROM sessions INDEXED BY sessions_cwd_cover_idx
     WHERE id NOT IN (SELECT id FROM sessions WHERE inbox_ask IS NOT NULL)
       AND has_user_message = 1
       AND updated_at >= ?1
       AND created_at < ?2";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageHistoryRequest {
    /// Local midnights, ascending. Day `i` covers
    /// `[day_starts[i], day_starts[i + 1])`, so there is one more boundary
    /// than there are days. The web view computes them because it owns the
    /// time zone the days are labelled in.
    pub day_starts: Vec<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageHistory {
    pub buckets: Vec<UsageBucket>,
    /// Sessions with at least one counted turn in the period.
    pub sessions: u64,
    /// Sessions active in the period that recorded no token usage at all.
    pub unreported: Vec<UnreportedUsage>,
}

/// Token totals for one day, agent, model and project.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBucket {
    /// Index into the request's days.
    pub day: usize,
    pub harness: String,
    /// Saved model id, e.g. `claude:opus-4.5` or `codex:gpt-5.1-codex`.
    pub model: String,
    /// Picker label the turn was sent with. A moving alias such as
    /// `claude:opus` names its concrete version here.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_name: Option<String>,
    /// Session project (`cwd`), not the worktree it ran in.
    pub project: String,
    pub turns: u64,
    /// Input that was neither read from nor written to the cache.
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnreportedUsage {
    pub harness: String,
    pub sessions: u64,
}

#[tauri::command(async)]
pub fn usage_history(
    store: State<'_, SessionStore>,
    request: UsageHistoryRequest,
) -> Result<UsageHistory, String> {
    validate_day_starts(&request.day_starts)?;
    store.with_read_conn(|conn| {
        aggregate_usage(conn, &request.day_starts).map_err(|e| e.to_string())
    })
}

fn validate_day_starts(day_starts: &[i64]) -> Result<(), String> {
    if day_starts.len() < 2 || day_starts.len() > MAX_DAYS + 1 {
        return Err(format!("usage history covers 1 to {MAX_DAYS} days"));
    }
    if day_starts.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err("usage history days must be ascending".into());
    }
    Ok(())
}

/// The fields of a saved block that usage needs. Everything else, including
/// message text and tool output, is skipped without being allocated.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredBlock {
    #[serde(default)]
    role: Option<Value>,
    #[serde(default)]
    draft: Option<Value>,
    #[serde(default)]
    started_at: Option<Value>,
    #[serde(default)]
    sent_at: Option<Value>,
    #[serde(default)]
    turn_model: Option<Value>,
    #[serde(default)]
    turn_metrics: Option<Value>,
}

struct Tokens {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
}

/// One user turn: the block that started it plus any messages steered in
/// while it ran.
struct Turn {
    at: Option<i64>,
    harness: Option<String>,
    model: Option<String>,
    model_name: Option<String>,
    metrics: Option<Value>,
}

type BucketKey = (usize, String, String, Option<String>, String);

pub(crate) fn aggregate_usage(
    conn: &Connection,
    day_starts: &[i64],
) -> rusqlite::Result<UsageHistory> {
    let (Some(&since), Some(&until)) = (day_starts.first(), day_starts.last()) else {
        return Ok(UsageHistory::default());
    };
    let mut statement = conn.prepare(SCAN_SQL)?;
    let mut rows = statement.query(params![since, until])?;

    let mut buckets: HashMap<BucketKey, UsageBucket> = HashMap::new();
    let mut unreported: BTreeMap<String, u64> = BTreeMap::new();
    let mut sessions = 0u64;
    while let Some(row) = rows.next()? {
        let harness: String = row.get(0)?;
        let model: String = row.get(1)?;
        let project: String = row.get(2)?;
        let updated_at: i64 = row.get(3)?;
        let blocks = row.get_ref(4)?;
        let blocks = std::str::from_utf8(blocks.as_bytes().unwrap_or_default()).unwrap_or("");
        let turns = if blocks.contains(METRICS_KEY) {
            // A transcript that fails to parse is skipped, not fatal: one bad
            // row must not blank the whole page.
            serde_json::from_str::<Vec<StoredBlock>>(blocks)
                .map(user_turns)
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        if !turns.iter().any(|turn| turn.metrics.is_some()) {
            *unreported.entry(harness).or_default() += 1;
            continue;
        }

        let mut counted = false;
        for turn in turns {
            let Some(metrics) = turn.metrics.as_ref() else {
                continue;
            };
            let Some(day) = day_index(day_starts, turn.at.unwrap_or(updated_at)) else {
                continue;
            };
            let turn_harness = turn.harness.unwrap_or_else(|| harness.clone());
            let Some(tokens) = normalized_tokens(&turn_harness, metrics) else {
                continue;
            };
            let (turn_model, model_name) = match turn.model {
                Some(id) => (id, turn.model_name),
                None => (model.clone(), None),
            };
            let key = (day, turn_harness, turn_model, model_name, project.clone());
            let bucket = buckets.entry(key).or_insert_with_key(|key| UsageBucket {
                day: key.0,
                harness: key.1.clone(),
                model: key.2.clone(),
                model_name: key.3.clone(),
                project: key.4.clone(),
                ..UsageBucket::default()
            });
            bucket.turns += 1;
            bucket.input_tokens += tokens.input;
            bucket.output_tokens += tokens.output;
            bucket.cache_read_tokens += tokens.cache_read;
            bucket.cache_write_tokens += tokens.cache_write;
            counted = true;
        }
        if counted {
            sessions += 1;
        }
    }

    let mut buckets: Vec<UsageBucket> = buckets.into_values().collect();
    buckets.sort_by(|a, b| {
        (a.day, &a.harness, &a.model, &a.model_name, &a.project).cmp(&(
            b.day,
            &b.harness,
            &b.model,
            &b.model_name,
            &b.project,
        ))
    });
    Ok(UsageHistory {
        buckets,
        sessions,
        unreported: unreported
            .into_iter()
            .map(|(harness, sessions)| UnreportedUsage { harness, sessions })
            .collect(),
    })
}

/// Groups top-level user blocks into turns.
///
/// Harness metrics land on whichever user block is last when they arrive, and
/// Codex, Pi and OpenCode restate the running total for the whole turn. A
/// message steered into a running turn (`sentAt`, no `startedAt`) therefore
/// holds the turn's later total, which already includes what the block
/// before it recorded. Keeping only the last reading per turn counts it once.
fn user_turns(blocks: Vec<StoredBlock>) -> Vec<Turn> {
    let mut turns: Vec<Turn> = Vec::new();
    for block in blocks {
        if block.role.as_ref().and_then(Value::as_str) != Some("user")
            || block.draft.as_ref().and_then(Value::as_bool) == Some(true)
        {
            continue;
        }
        let started_at = block.started_at.as_ref().and_then(epoch_ms);
        let sent_at = block.sent_at.as_ref().and_then(epoch_ms);
        let steered = started_at.is_none() && sent_at.is_some() && !turns.is_empty();
        if !steered {
            let (harness, model, model_name) = turn_model(block.turn_model.as_ref());
            turns.push(Turn {
                at: started_at.or(sent_at),
                harness,
                model,
                model_name,
                metrics: None,
            });
        }
        if let (Some(metrics), Some(turn)) = (block.turn_metrics, turns.last_mut()) {
            if metrics.is_object() {
                turn.metrics = Some(metrics);
            }
        }
    }
    turns
}

fn turn_model(value: Option<&Value>) -> (Option<String>, Option<String>, Option<String>) {
    let field = |key: &str| {
        value
            .and_then(|model| model.get(key))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_owned)
    };
    (field("harness"), field("id"), field("name"))
}

fn epoch_ms(value: &Value) -> Option<i64> {
    let ms = value.as_f64()?;
    (ms.is_finite() && ms > 0.0).then_some(ms as i64)
}

fn day_index(day_starts: &[i64], at: i64) -> Option<usize> {
    let after = day_starts.partition_point(|start| *start <= at);
    (after > 0 && after < day_starts.len()).then(|| after - 1)
}

/// Splits a turn's metrics into disjoint input, cache and output counts.
///
/// Claude, Pi, OpenCode and the ACP agents report input with cached tokens
/// already taken out. Codex reports OpenAI's input, which still contains the
/// cache reads, so they are subtracted here to match.
fn normalized_tokens(harness: &str, metrics: &Value) -> Option<Tokens> {
    let count = |key: &str| {
        metrics
            .get(key)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value > 0.0)
            .map_or(0, |value| value.round() as u64)
    };
    let mut tokens = Tokens {
        input: count("inputTokens"),
        output: count("outputTokens"),
        cache_read: count("cacheReadTokens"),
        cache_write: count("cacheWriteTokens"),
    };
    if harness == "codex" {
        tokens.input = tokens.input.saturating_sub(tokens.cache_read);
    }
    let any = tokens.input + tokens.output + tokens.cache_read + tokens.cache_write > 0;
    any.then_some(tokens)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_store::{upsert_session, SessionUpsert};
    use serde_json::json;

    const DAY: i64 = 86_400_000;
    /// 2026-10-01T00:00:00Z, standing in for a local midnight.
    const START: i64 = 1_790_812_800_000;

    fn week() -> Vec<i64> {
        (0..=7).map(|day| START + day * DAY).collect()
    }

    fn session(id: &str, harness: &str, model: &str, cwd: &str, blocks: Value) -> SessionUpsert {
        SessionUpsert {
            sidebar_hidden: false,
            id: id.into(),
            cwd: cwd.into(),
            harness: harness.into(),
            model: model.into(),
            model_settings: json!({}),
            runtime_mode: "supervised".into(),
            title: id.into(),
            provider_session_id: None,
            provider_account_id: None,
            blocks,
            queued_messages: vec![],
            queue_status: None,
            context_used: None,
            context_window: None,
            branch: None,
            worktree_cwd: None,
            worktree_removed: false,
            linked_work_item: None,
            automation_id: None,
        }
    }

    fn user(id: &str, started_at: i64, metrics: Value) -> Value {
        json!({ "id": id, "role": "user", "text": "go", "startedAt": started_at, "turnMetrics": metrics })
    }

    /// Saved sessions get `now` timestamps; pin them inside the test period.
    fn save(conn: &Connection, upsert: &SessionUpsert, created_at: i64, updated_at: i64) {
        upsert_session(conn, upsert).unwrap();
        conn.execute(
            "UPDATE sessions SET created_at = ?2, updated_at = ?3 WHERE id = ?1",
            params![upsert.id, created_at, updated_at],
        )
        .unwrap();
    }

    #[test]
    fn sums_turns_into_day_agent_model_and_project_buckets() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let blocks = json!([
            user("u1", START + 3_600_000, json!({ "inputTokens": 100, "outputTokens": 20, "cacheReadTokens": 1_000, "cacheWriteTokens": 50 })),
            { "id": "a1", "role": "assistant", "text": "done ".repeat(1_000) },
            user("u2", START + 7_200_000, json!({ "inputTokens": 10, "outputTokens": 5 })),
            user("u3", START + DAY + 60_000, json!({ "outputTokens": 7 })),
        ]);
        save(
            &conn,
            &session("s1", "claude", "claude:opus-4.5", "/work/app", blocks),
            START,
            START + 2 * DAY,
        );

        let history = aggregate_usage(&conn, &week()).unwrap();
        assert_eq!(history.sessions, 1);
        assert_eq!(
            history.buckets,
            vec![
                UsageBucket {
                    day: 0,
                    harness: "claude".into(),
                    model: "claude:opus-4.5".into(),
                    model_name: None,
                    project: "/work/app".into(),
                    turns: 2,
                    input_tokens: 110,
                    output_tokens: 25,
                    cache_read_tokens: 1_000,
                    cache_write_tokens: 50,
                },
                UsageBucket {
                    day: 1,
                    harness: "claude".into(),
                    model: "claude:opus-4.5".into(),
                    model_name: None,
                    project: "/work/app".into(),
                    turns: 1,
                    output_tokens: 7,
                    ..UsageBucket::default()
                },
            ]
        );
    }

    #[test]
    fn attributes_each_turn_to_the_model_it_was_sent_with() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut first = user("u1", START + 1_000, json!({ "outputTokens": 1 }));
        first["turnModel"] =
            json!({ "harness": "claude", "id": "claude:opus", "name": "Opus 5.5" });
        let mut second = user("u2", START + 2_000, json!({ "outputTokens": 2 }));
        // The session switched provider mid-conversation.
        second["turnModel"] =
            json!({ "harness": "codex", "id": "codex:gpt-5.1-codex", "name": "GPT-5.1-Codex" });
        save(
            &conn,
            &session(
                "s1",
                "codex",
                "codex:gpt-5.1-codex",
                "/work/app",
                json!([first, second]),
            ),
            START,
            START + 3_000,
        );

        let history = aggregate_usage(&conn, &week()).unwrap();
        let models: Vec<_> = history
            .buckets
            .iter()
            .map(|bucket| {
                (
                    bucket.harness.as_str(),
                    bucket.model.as_str(),
                    bucket.model_name.as_deref(),
                    bucket.output_tokens,
                )
            })
            .collect();
        assert_eq!(
            models,
            vec![
                ("claude", "claude:opus", Some("Opus 5.5"), 1),
                ("codex", "codex:gpt-5.1-codex", Some("GPT-5.1-Codex"), 2),
            ]
        );
    }

    #[test]
    fn codex_input_drops_the_cache_reads_it_includes() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let blocks = json!([user(
            "u1",
            START + 1_000,
            json!({ "inputTokens": 90_000, "outputTokens": 3_000, "cacheReadTokens": 30_000 })
        )]);
        save(
            &conn,
            &session("s1", "codex", "codex:gpt-5", "/work/app", blocks),
            START,
            START + 2_000,
        );

        let bucket = &aggregate_usage(&conn, &week()).unwrap().buckets[0];
        assert_eq!(bucket.input_tokens, 60_000);
        assert_eq!(bucket.cache_read_tokens, 30_000);
        assert_eq!(bucket.output_tokens, 3_000);
    }

    #[test]
    fn a_steered_message_replaces_its_turns_running_total() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let blocks = json!([
            user("u1", START + 1_000, json!({ "inputTokens": 40_000, "outputTokens": 1_000 })),
            { "id": "s1", "role": "user", "text": "also this", "sentAt": START + 2_000,
              "turnMetrics": { "inputTokens": 90_000, "outputTokens": 3_000 } },
            user("u2", START + 5_000, json!({ "inputTokens": 5, "outputTokens": 5 })),
        ]);
        save(
            &conn,
            &session("s1", "pi", "pi:default", "/work/app", blocks),
            START,
            START + 6_000,
        );

        let bucket = &aggregate_usage(&conn, &week()).unwrap().buckets[0];
        assert_eq!(bucket.turns, 2);
        assert_eq!(bucket.input_tokens, 90_005);
        assert_eq!(bucket.output_tokens, 3_005);
    }

    #[test]
    fn leaves_out_turns_and_sessions_outside_the_period() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let blocks = json!([
            user("before", START - 1, json!({ "outputTokens": 1 })),
            user("inside", START + 6 * DAY, json!({ "outputTokens": 2 })),
            user("after", START + 7 * DAY, json!({ "outputTokens": 4 })),
        ]);
        save(
            &conn,
            &session("long", "claude", "claude:opus-4.5", "/a", blocks),
            START - DAY,
            START + 8 * DAY,
        );
        let old = json!([user("u1", START - 2 * DAY, json!({ "outputTokens": 8 }))]);
        save(
            &conn,
            &session("old", "claude", "claude:opus-4.5", "/a", old),
            START - 3 * DAY,
            START - 2 * DAY,
        );

        let history = aggregate_usage(&conn, &week()).unwrap();
        assert_eq!(history.sessions, 1);
        assert_eq!(history.buckets.len(), 1);
        assert_eq!(history.buckets[0].day, 6);
        assert_eq!(history.buckets[0].output_tokens, 2);
        assert!(history.unreported.is_empty());
    }

    #[test]
    fn reports_agents_whose_sessions_recorded_no_tokens() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let quiet = json!([{ "id": "u1", "role": "user", "text": "\"turnMetrics\" in prose", "startedAt": START + 1_000 }]);
        save(
            &conn,
            &session("c1", "cursor", "cursor:auto", "/a", quiet.clone()),
            START,
            START + 2_000,
        );
        save(
            &conn,
            &session("c2", "cursor", "cursor:auto", "/b", quiet),
            START,
            START + 2_000,
        );
        // An unsent draft counts for nothing, even with stray metrics on it.
        let draft = json!([{ "id": "u1", "role": "user", "text": "later", "draft": true, "turnMetrics": { "outputTokens": 9 } }]);
        save(
            &conn,
            &session("d1", "grok", "grok:grok-4.6", "/a", draft),
            START,
            START + 2_000,
        );

        let history = aggregate_usage(&conn, &week()).unwrap();
        assert!(history.buckets.is_empty());
        assert_eq!(history.sessions, 0);
        assert_eq!(
            history.unreported,
            vec![
                UnreportedUsage {
                    harness: "cursor".into(),
                    sessions: 2
                },
                UnreportedUsage {
                    harness: "grok".into(),
                    sessions: 1
                },
            ]
        );
    }

    #[test]
    fn skips_legacy_inbox_chats_and_unreadable_transcripts() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let blocks = json!([user("u1", START + 1_000, json!({ "outputTokens": 3 }))]);
        save(
            &conn,
            &session("ask", "claude", "claude:opus-4.5", "/a", blocks.clone()),
            START,
            START + 2_000,
        );
        conn.execute("UPDATE sessions SET inbox_ask = '{}' WHERE id = 'ask'", [])
            .unwrap();
        save(
            &conn,
            &session("ok", "claude", "claude:opus-4.5", "/a", blocks),
            START,
            START + 2_000,
        );
        save(
            &conn,
            &session("bad", "claude", "claude:opus-4.5", "/a", json!([])),
            START,
            START + 2_000,
        );
        conn.execute(
            "UPDATE sessions SET blocks_json = '[{\"role\":\"user\",\"turnMetrics\":' , has_user_message = 1 WHERE id = 'bad'",
            [],
        )
        .unwrap();

        let history = aggregate_usage(&conn, &week()).unwrap();
        assert_eq!(history.sessions, 1);
        assert_eq!(history.buckets[0].output_tokens, 3);
        assert_eq!(
            history.unreported,
            vec![UnreportedUsage {
                harness: "claude".into(),
                sessions: 1
            }]
        );
    }

    #[test]
    fn falls_back_to_the_session_model_and_last_activity() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        // Transcripts from before turns were stamped carry neither.
        let blocks = json!([{ "id": "u1", "role": "user", "text": "go", "turnMetrics": { "inputTokens": 4 } }]);
        save(
            &conn,
            &session(
                "s1",
                "opencode",
                "opencode:anthropic/claude-sonnet-4-5",
                "/a",
                blocks,
            ),
            START,
            START + 3 * DAY + 5,
        );

        let bucket = &aggregate_usage(&conn, &week()).unwrap().buckets[0];
        assert_eq!(bucket.day, 3);
        assert_eq!(bucket.harness, "opencode");
        assert_eq!(bucket.model, "opencode:anthropic/claude-sonnet-4-5");
        assert_eq!(bucket.input_tokens, 4);
    }

    #[test]
    fn scans_on_the_query_only_connection() {
        let path = std::env::temp_dir().join(format!(
            "monocode-usage-history-{}-{}.db",
            std::process::id(),
            crate::session_store::now_millis()
        ));
        let store = SessionStore::open(path.clone()).unwrap();
        let blocks = json!([user("u1", START + 1_000, json!({ "outputTokens": 3 }))]);
        save(
            &store.lock_conn().unwrap(),
            &session("s1", "claude", "claude:opus-4.5", "/a", blocks),
            START,
            START + 2_000,
        );

        let (history, writable) = store
            .with_read_conn(|conn| {
                let history = aggregate_usage(conn, &week()).map_err(|e| e.to_string())?;
                let writable = conn
                    .execute("UPDATE sessions SET title = 'nope'", [])
                    .is_ok();
                Ok((history, writable))
            })
            .unwrap();
        assert_eq!(history.buckets[0].output_tokens, 3);
        assert!(!writable);
        drop(store);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn day_boundaries_must_ascend_and_stay_bounded() {
        assert!(validate_day_starts(&week()).is_ok());
        assert!(validate_day_starts(&[START]).is_err());
        assert!(validate_day_starts(&[START, START]).is_err());
        let too_many: Vec<i64> = (0..=(MAX_DAYS as i64 + 1))
            .map(|day| START + day * DAY)
            .collect();
        assert!(validate_day_starts(&too_many).is_err());
    }

    #[test]
    fn the_scan_filters_through_the_covering_index() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut statement = conn
            .prepare(&format!("EXPLAIN QUERY PLAN {SCAN_SQL}"))
            .unwrap();
        let plan: Vec<String> = statement
            .query_map(params![START, START + DAY], |row| row.get::<_, String>(3))
            .unwrap()
            .map(|row| row.unwrap())
            .collect();
        for step in &plan {
            if step.contains("sessions") {
                assert!(step.contains("USING"), "table scan: {step}");
            }
        }
    }
}
