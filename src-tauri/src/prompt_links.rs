//! `onmicode://` prompt links.
//!
//! The deep-link plugin reports a link from an Apple Event on macOS. On Windows
//! and Linux the OS starts a new process with the link as its only argument:
//! single-instance relays that to the running app, and a cold start reads it
//! from its own arguments. Links wait here until one workspace window takes
//! them. The window parses and reviews each one, so a link never reaches an
//! agent without the user.

use std::path::Path;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_deep_link::DeepLinkExt;

const OPEN: &str = "monocode:prompt-link-open";
const SCHEME_PREFIX: &str = "onmicode:";
/// Far above any link the app builds, so only junk is dropped here; the
/// window applies the real limits and explains them.
const MAX_URL_LEN: usize = 64 * 1024;
/// A burst of clicks should not stack reviews without end.
const MAX_PENDING: usize = 8;
const MAX_REMOTE_LOOKUPS: usize = 64;

#[derive(Default)]
pub struct PromptLinks {
    pending: Mutex<Pending>,
}

#[derive(Default)]
struct Pending {
    urls: Vec<String>,
    /// The window chosen to review them, while it still exists.
    window_label: Option<String>,
}

fn is_prompt_link(url: &str) -> bool {
    url.len() <= MAX_URL_LEN
        && url
            .get(..SCHEME_PREFIX.len())
            .is_some_and(|scheme| scheme.eq_ignore_ascii_case(SCHEME_PREFIX))
}

/// A second launch whose only argument is a link, which the deep-link plugin
/// has already queued. Anything else is a plain relaunch.
#[cfg(any(windows, target_os = "linux"))]
pub(crate) fn is_link_launch(args: &[String]) -> bool {
    matches!(args, [_, url] if is_prompt_link(url) && url::Url::parse(url).is_ok())
}

fn push(pending: &mut Vec<String>, urls: Vec<String>) {
    for url in urls {
        if pending.len() >= MAX_PENDING {
            break;
        }
        if is_prompt_link(&url) && !pending.contains(&url) {
            pending.push(url);
        }
    }
}

fn claims(chosen: Option<&str>, window: &str, chosen_exists: bool) -> bool {
    chosen.is_none_or(|label| label == window || !chosen_exists)
}

fn queue(app: &AppHandle, urls: Vec<String>) {
    if !urls.iter().any(|url| is_prompt_link(url)) {
        return;
    }
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let windows = crate::window::workspace_windows(&handle);
        let target = windows
            .iter()
            .find(|window| window.is_focused().unwrap_or(false))
            .or_else(|| windows.iter().find(|window| window.label() == "main"))
            .or_else(|| windows.first());
        if let Ok(mut pending) = handle.state::<PromptLinks>().pending.lock() {
            push(&mut pending.urls, urls);
            pending.window_label = target.map(|window| window.label().to_string());
        }
        match target {
            Some(window) => {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.emit(OPEN, ());
            }
            // A new window takes them once it mounts.
            None => {
                let _ = crate::window::open_new_window(&handle);
            }
        }
    });
}

/// Links waiting for this window. Every other window gets none.
#[tauri::command]
pub fn prompt_link_take(
    app: AppHandle,
    window: WebviewWindow,
    links: State<'_, PromptLinks>,
) -> Result<Vec<String>, String> {
    let mut pending = links.pending.lock().map_err(|error| error.to_string())?;
    let chosen = pending.window_label.as_deref();
    let chosen_exists = chosen.is_some_and(|label| app.get_webview_window(label).is_some());
    if !claims(chosen, window.label(), chosen_exists) {
        return Ok(Vec::new());
    }
    pending.window_label = None;
    Ok(std::mem::take(&mut pending.urls))
}

/// Remote URLs of each project, origin first, so a link naming `owner/name`
/// can find the local clone. A folder without git has none.
#[tauri::command]
pub async fn prompt_link_remotes(paths: Vec<String>) -> Result<Vec<Vec<String>>, String> {
    if paths.len() > MAX_REMOTE_LOOKUPS {
        return Err("Too many projects to look up".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::scope(|scope| {
            let lookups: Vec<_> = paths
                .iter()
                .map(|path| scope.spawn(move || remote_urls(&crate::fs::expand_home(path))))
                .collect();
            lookups
                .into_iter()
                .map(|lookup| lookup.join().unwrap_or_default())
                .collect()
        })
    })
    .await
    .map_err(|error| error.to_string())
}

fn remote_urls(root: &Path) -> Vec<String> {
    crate::fs::git_stdout(root, &["remote", "-v"])
        .map(|text| parse_remotes(&text))
        .unwrap_or_default()
}

fn parse_remotes(text: &str) -> Vec<String> {
    let mut remotes: Vec<(&str, &str)> = Vec::new();
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let (Some(name), Some(url)) = (parts.next(), parts.next()) else {
            continue;
        };
        if !remotes.iter().any(|(_, seen)| *seen == url) {
            remotes.push((name, url));
        }
    }
    // Stable, so the other remotes keep git's order.
    remotes.sort_by_key(|(name, _)| *name != "origin");
    remotes
        .into_iter()
        .map(|(_, url)| url.to_string())
        .collect()
}

pub(crate) fn init(app: &AppHandle) {
    app.manage(PromptLinks::default());
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        queue(
            &handle,
            event.urls().into_iter().map(String::from).collect(),
        );
    });
    // Windows and Linux read a cold start's link from the arguments before
    // this listener exists. macOS reports it later as an open-URL event.
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        queue(app, urls.into_iter().map(String::from).collect());
    }
    // Installers register the scheme; an AppImage has no installer.
    #[cfg(target_os = "linux")]
    if app.env().appimage.is_some() {
        let handle = app.clone();
        std::thread::spawn(move || {
            let _ = handle.deep_link().register_all();
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_onmicode_links_within_the_size_cap_are_kept() {
        assert!(is_prompt_link("onmicode://new?prompt=hi"));
        assert!(is_prompt_link("ONMICODE://new?prompt=hi"));
        assert!(!is_prompt_link("https://example.com"));
        assert!(!is_prompt_link("onmi"));
        assert!(!is_prompt_link(&format!(
            "onmicode://new?prompt={}",
            "x".repeat(MAX_URL_LEN)
        )));
    }

    #[test]
    fn pending_links_skip_duplicates_and_stop_at_the_cap() {
        let mut pending = vec!["onmicode://new?prompt=a".to_string()];
        push(
            &mut pending,
            vec![
                "onmicode://new?prompt=a".into(),
                "https://example.com".into(),
                "onmicode://new?prompt=b".into(),
            ],
        );
        assert_eq!(
            pending,
            ["onmicode://new?prompt=a", "onmicode://new?prompt=b"]
        );
        push(
            &mut pending,
            (0..20)
                .map(|index| format!("onmicode://new?prompt={index}"))
                .collect(),
        );
        assert_eq!(pending.len(), MAX_PENDING);
    }

    #[test]
    fn only_the_chosen_window_takes_links_while_it_exists() {
        assert!(claims(None, "main", false));
        assert!(claims(Some("main"), "main", true));
        assert!(!claims(Some("main"), "window-2", true));
        assert!(claims(Some("window-3"), "main", false));
    }

    #[cfg(any(windows, target_os = "linux"))]
    #[test]
    fn a_relaunch_is_a_link_launch_only_with_a_single_link_argument() {
        let args = |list: &[&str]| list.iter().map(|arg| arg.to_string()).collect::<Vec<_>>();
        assert!(is_link_launch(&args(&[
            "onmicode.exe",
            "onmicode://new?prompt=hi"
        ])));
        assert!(!is_link_launch(&args(&["onmicode.exe"])));
        assert!(!is_link_launch(&args(&["onmicode.exe", "--flag"])));
        assert!(!is_link_launch(&args(&["onmicode.exe", "onmicode://ne w"])));
        assert!(!is_link_launch(&args(&[
            "onmicode.exe",
            "onmicode://new?prompt=hi",
            "extra"
        ])));
    }

    #[test]
    fn remotes_are_listed_once_with_origin_first() {
        let text = "fork\tgit@github.com:me/app.git (fetch)\n\
                    fork\tgit@github.com:me/app.git (push)\n\
                    origin\thttps://github.com/team/app.git (fetch)\n\
                    origin\thttps://github.com/team/app.git (push)\n\
                    upstream\thttps://github.com/up/app.git (fetch)\n";
        assert_eq!(
            parse_remotes(text),
            [
                "https://github.com/team/app.git",
                "git@github.com:me/app.git",
                "https://github.com/up/app.git"
            ]
        );
    }
}
