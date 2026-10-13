#[cfg(not(target_arch = "wasm32"))]
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
#[cfg(not(target_arch = "wasm32"))]
use std::path::{Path, PathBuf};
#[cfg(not(target_arch = "wasm32"))]
use std::sync::mpsc::channel;
#[cfg(not(target_arch = "wasm32"))]
use std::thread;
#[cfg(not(target_arch = "wasm32"))]
use std::time::Duration;

#[cfg(not(target_arch = "wasm32"))]
pub struct NativeFileWatcher;

#[cfg(not(target_arch = "wasm32"))]
impl NativeFileWatcher {
    /// Spawns a background thread that monitors project directories natively via OS APIs
    pub fn start<F>(watch_dir: PathBuf, on_file_changed: F)
    where
        F: Fn(PathBuf) + Send + 'static,
    {
        thread::spawn(move || {
            let (tx, rx) = channel();

            let config = Config::default()
                .with_poll_interval(Duration::from_millis(500));

            let mut watcher: match_watcher_type = match RecommendedWatcher::new(tx, config) {
                Ok(w) => w,
                Err(e) => {
                    eprintln!("[Rust Watcher] Failed to initialize native watcher: {}", e);
                    return;
                }
            };

            let target_path = if watch_dir.join("lib").exists() {
                watch_dir.join("lib")
            } else {
                watch_dir
            };

            if let Err(e) = watcher.watch(&target_path, RecursiveMode::Recursive) {
                eprintln!("[Rust Watcher] Failed to watch path '{}': {}", target_path.display(), e);
                return;
            }

            eprintln!("[Rust Watcher] ⚡ Watching '{}' natively via OS events (0ms latency)", target_path.display());

            for res in rx {
                match res {
                    Ok(Event { kind, paths, .. }) => {
                        match kind {
                            EventKind::Modify(_) | EventKind::Create(_) => {
                                for path in paths {
                                    if path.extension().map_or(false, |ext| ext == "dart") {
                                        on_file_changed(path);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                    Err(e) => {
                        eprintln!("[Rust Watcher] Watch error: {:?}", e);
                    }
                }
            }
        });
    }
}

#[cfg(not(target_arch = "wasm32"))]
type match_watcher_type = RecommendedWatcher;
