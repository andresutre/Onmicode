//! Visual replies: self-contained HTML pages an agent writes into a reply,
//! served to the sandboxed frames that show them in the transcript.
//!
//! A `srcdoc` frame would inherit the app's own CSP, whose `script-src 'self'`
//! blocks every inline script, so a page is registered here and served from
//! its own scheme with a CSP that runs inline code but reaches no network.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::{Arc, Mutex};

use sha2::{Digest, Sha256};
use tauri::http::{Method, Request, Response};
use tauri::{AppHandle, Manager, Runtime, State};

/// Serves registered pages. `frame-src` in tauri.conf.json allows only this
/// scheme, which also keeps a page from navigating its frame anywhere else.
pub const SCHEME: &str = "visual";

/// Above the frontend's own limit, which shows a larger page as code instead,
/// with room for the theme and bootstrap it adds.
const MAX_PAGE_BYTES: usize = 1024 * 1024;

/// Least recently served pages are dropped past this. A frame registers its
/// page again whenever it mounts, so only a long-parked frame can lose one.
const MAX_STORED_BYTES: usize = 32 * 1024 * 1024;

/// Inline scripts and styles run, but nothing loads from or reaches the
/// network, and the page cannot frame, submit forms or leave its sandbox, even
/// if something opens its URL outside a sandboxed frame.
const PAGE_CSP: &str = "sandbox allow-scripts; default-src 'none'; \
    script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; \
    font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; \
    worker-src 'none'; form-action 'none'; base-uri 'none'";

#[derive(Default)]
pub struct VisualPages(Mutex<Pages>);

#[derive(Default)]
struct Pages {
    entries: HashMap<String, Page>,
    bytes: usize,
    clock: u64,
}

struct Page {
    html: Arc<str>,
    used: u64,
}

impl Pages {
    /// Stores `html` under its content hash, so registering it again reuses it.
    fn insert(&mut self, html: String) -> String {
        let id = page_id(&html);
        self.clock += 1;
        let used = self.clock;
        if let Some(page) = self.entries.get_mut(&id) {
            page.used = used;
            return id;
        }
        self.bytes += html.len();
        self.entries.insert(
            id.clone(),
            Page {
                html: html.into(),
                used,
            },
        );
        self.evict(&id);
        id
    }

    fn get(&mut self, id: &str) -> Option<Arc<str>> {
        self.clock += 1;
        let used = self.clock;
        let page = self.entries.get_mut(id)?;
        page.used = used;
        Some(page.html.clone())
    }

    fn evict(&mut self, keep: &str) {
        while self.bytes > MAX_STORED_BYTES {
            let Some(oldest) = self
                .entries
                .iter()
                .filter(|(id, _)| id.as_str() != keep)
                .min_by_key(|(_, page)| page.used)
                .map(|(id, _)| id.clone())
            else {
                return;
            };
            if let Some(page) = self.entries.remove(&oldest) {
                self.bytes -= page.html.len();
            }
        }
    }
}

fn page_id(html: &str) -> String {
    Sha256::digest(html.as_bytes())
        .iter()
        .fold(String::with_capacity(64), |mut id, byte| {
            let _ = write!(id, "{byte:02x}");
            id
        })
}

/// Registers a complete page and returns the id its frame loads it by.
#[tauri::command(async)]
pub fn visual_register(pages: State<'_, VisualPages>, html: String) -> Result<String, String> {
    register(&pages.0, html)
}

fn register(pages: &Mutex<Pages>, html: String) -> Result<String, String> {
    if html.len() > MAX_PAGE_BYTES {
        return Err("This visual is too large to show.".into());
    }
    let mut pages = pages
        .lock()
        .map_err(|_| "Visuals are unavailable.".to_string())?;
    Ok(pages.insert(html))
}

/// Serves `<scheme>://localhost/<id>` for a registered page.
pub fn serve<R: Runtime>(app: &AppHandle<R>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() != Method::GET {
        return not_found();
    }
    let id = request.uri().path().trim_start_matches('/');
    let html = app
        .try_state::<VisualPages>()
        .and_then(|pages| pages.0.lock().ok()?.get(id));
    match html {
        Some(html) => page_response(&html),
        None => not_found(),
    }
}

fn page_response(html: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(200)
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", PAGE_CSP)
        .header("Cache-Control", "no-store")
        .header("Referrer-Policy", "no-referrer")
        .header("X-Content-Type-Options", "nosniff")
        .body(html.as_bytes().to_vec())
        .unwrap_or_else(|_| not_found())
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(404)
        .body(Vec::new())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_registers_under_its_content_hash() {
        let pages = Mutex::new(Pages::default());
        let first = register(&pages, "<p>chart</p>".into()).unwrap();
        let again = register(&pages, "<p>chart</p>".into()).unwrap();
        let other = register(&pages, "<p>table</p>".into()).unwrap();
        assert_eq!(first, again);
        assert_ne!(first, other);
        assert_eq!(first.len(), 64);
        assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
        let mut stored = pages.lock().unwrap();
        assert_eq!(stored.entries.len(), 2);
        assert_eq!(stored.bytes, "<p>chart</p>".len() + "<p>table</p>".len());
        assert_eq!(stored.get(&first).as_deref(), Some("<p>chart</p>"));
        assert!(stored.get("missing").is_none());
    }

    #[test]
    fn an_oversized_page_is_refused() {
        let pages = Mutex::new(Pages::default());
        assert!(register(&pages, "x".repeat(MAX_PAGE_BYTES + 1)).is_err());
        assert!(register(&pages, "x".repeat(MAX_PAGE_BYTES)).is_ok());
    }

    #[test]
    fn the_least_recently_served_page_goes_first() {
        let mut pages = Pages::default();
        let page = |fill: char| fill.to_string().repeat(MAX_PAGE_BYTES);
        let first = pages.insert(page('a'));
        let second = pages.insert(page('b'));
        // Serving the first page makes the second the oldest.
        pages.get(&first);
        let fits = MAX_STORED_BYTES / MAX_PAGE_BYTES;
        for fill in ('c'..='z').chain('A'..='Z').take(fits - 1) {
            pages.insert(page(fill));
        }
        assert_eq!(pages.entries.len(), fits);
        assert_eq!(pages.bytes, MAX_STORED_BYTES);
        assert!(pages.entries.contains_key(&first));
        assert!(!pages.entries.contains_key(&second));
    }

    #[test]
    fn a_served_page_is_sandboxed_with_no_network() {
        let response = page_response("<p>hi</p>");
        assert_eq!(response.status(), 200);
        let csp = response.headers()["Content-Security-Policy"]
            .to_str()
            .unwrap();
        assert!(csp.starts_with("sandbox allow-scripts;"));
        assert!(!csp.contains("allow-same-origin"));
        for directive in [
            "default-src 'none'",
            "connect-src 'none'",
            "frame-src 'none'",
            "form-action 'none'",
        ] {
            assert!(csp.contains(directive), "missing {directive}");
        }
        assert!(!csp.contains("https:"));
        assert_eq!(response.headers()["X-Content-Type-Options"], "nosniff");
        assert_eq!(response.body(), b"<p>hi</p>");
    }
}
