#[cfg(not(target_arch = "wasm32"))]
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
#[cfg(not(target_arch = "wasm32"))]
use std::collections::HashMap;
#[cfg(not(target_arch = "wasm32"))]
use std::path::PathBuf;
#[cfg(not(target_arch = "wasm32"))]
use std::sync::mpsc::{channel, Receiver, Sender};
#[cfg(not(target_arch = "wasm32"))]
use std::thread;
#[cfg(not(target_arch = "wasm32"))]
use std::time::{Duration, Instant};

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileWatchEvent {
    Modified(PathBuf),
    Removed(PathBuf),
}

#[cfg(not(target_arch = "wasm32"))]
pub struct WatcherHandle {
    stop_tx: Sender<()>,
}

#[cfg(not(target_arch = "wasm32"))]
impl WatcherHandle {
    pub fn stop(&self) {
        let _ = self.stop_tx.send(());
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl Drop for WatcherHandle {
    fn drop(&mut self) {
        let _ = self.stop_tx.send(());
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub struct NativeFileWatcher;

#[cfg(not(target_arch = "wasm32"))]
impl NativeFileWatcher {
    /// Spawns a managed background watcher with debouncing, Remove event tracking, and a stop handle
    pub fn start_managed(watch_dir: PathBuf) -> (WatcherHandle, Receiver<FileWatchEvent>) {
        let (stop_tx, stop_rx) = channel::<()>();
        let (event_tx, event_rx) = channel::<FileWatchEvent>();

        thread::spawn(move || {
            let (tx, rx) = channel();

            let config = Config::default().with_poll_interval(Duration::from_millis(500));

            let mut watcher: RecommendedWatcher = match RecommendedWatcher::new(tx, config) {
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
                eprintln!(
                    "[Rust Watcher] Failed to watch path '{}': {}",
                    target_path.display(),
                    e
                );
                return;
            }

            eprintln!(
                "[Rust Watcher] ⚡ Watching '{}' natively via OS events",
                target_path.display()
            );

            let mut last_seen: HashMap<PathBuf, Instant> = HashMap::new();
            let debounce_window = Duration::from_millis(120);

            loop {
                // Check if shutdown was requested
                if stop_rx.try_recv().is_ok() {
                    let _ = watcher.unwatch(&target_path);
                    break;
                }

                match rx.recv_timeout(Duration::from_millis(250)) {
                    Ok(Ok(Event { kind, paths, .. })) => {
                        let now = Instant::now();
                        for path in paths {
                            if !path.extension().map_or(false, |ext| ext == "dart") {
                                continue;
                            }

                            // Debounce rapid duplicate events for the same file
                            if let Some(&prev_time) = last_seen.get(&path) {
                                if now.duration_since(prev_time) < debounce_window {
                                    continue;
                                }
                            }
                            last_seen.insert(path.clone(), now);

                            match kind {
                                EventKind::Modify(_) | EventKind::Create(_) => {
                                    if path.exists() {
                                        let _ = event_tx.send(FileWatchEvent::Modified(path));
                                    } else {
                                        let _ = event_tx.send(FileWatchEvent::Removed(path));
                                    }
                                }
                                EventKind::Remove(_) => {
                                    let _ = event_tx.send(FileWatchEvent::Removed(path));
                                }
                                _ => {}
                            }
                        }
                    }
                    Ok(Err(e)) => {
                        eprintln!("[Rust Watcher] Watch error: {:?}", e);
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        (WatcherHandle { stop_tx }, event_rx)
    }

    /// Backwards-compatible callback starter
    pub fn start<F>(watch_dir: PathBuf, on_file_changed: F) -> WatcherHandle
    where
        F: Fn(PathBuf) + Send + 'static,
    {
        let (handle, rx) = Self::start_managed(watch_dir);
        thread::spawn(move || {
            for evt in rx {
                match evt {
                    FileWatchEvent::Modified(p) | FileWatchEvent::Removed(p) => {
                        on_file_changed(p);
                    }
                }
            }
        });
        handle
    }
}
