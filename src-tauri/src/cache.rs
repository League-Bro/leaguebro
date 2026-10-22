//! Saved downloads on disk, shared by patch notes (`patch.rs`) and OP.GG
//! recommendations (`opgg.rs`). Each uses its own folder under the app's
//! cache dir (`%LOCALAPPDATA%\dev.dom.leaguebro`), and Settings can show
//! and clear each one.

use anyhow::{Context, Result};
use serde::{de::DeserializeOwned, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Files in one cache folder. Read and write failures are ignored: the cache
/// only saves downloads, so a missing or broken file just means fetching again.
pub(crate) struct DiskCache {
    pub(crate) dir: Option<PathBuf>,
}

impl DiskCache {
    pub(crate) fn read<T: DeserializeOwned>(&self, name: &str) -> Option<T> {
        let bytes = std::fs::read(self.dir.as_ref()?.join(name)).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    pub(crate) fn write<T: Serialize>(&self, name: &str, value: &T) {
        let Some(dir) = &self.dir else { return };
        let save = || -> Result<()> {
            std::fs::create_dir_all(dir)?;
            // Write then rename, so a crash mid-write never leaves half a file.
            let tmp = dir.join(format!("{name}.tmp"));
            std::fs::write(&tmp, serde_json::to_vec(value)?)?;
            std::fs::rename(&tmp, dir.join(name))?;
            Ok(())
        };
        if let Err(e) = save() {
            eprintln!("couldn't save {name} to {}: {e:#}", dir.display());
        }
    }

    /// The saved files (`.json`, plus any `.tmp` left by a crash). Only those
    /// are counted or cleared, in case anything else ends up in the folder.
    fn files(&self) -> Vec<(PathBuf, u64)> {
        let Some(entries) = self.dir.as_ref().and_then(|d| std::fs::read_dir(d).ok()) else { return Vec::new() };
        entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json" || x == "tmp"))
            .filter_map(|e| Some((e.path(), e.metadata().ok().filter(|m| m.is_file())?.len())))
            .collect()
    }

    /// How many files are saved and their total size in bytes.
    pub(crate) fn usage(&self, in_memory: usize) -> CacheUsage {
        let files = self.files();
        CacheUsage { files: files.len(), bytes: files.iter().map(|(_, len)| len).sum(), in_memory }
    }

    /// Deletes every saved file. A file that's already gone (e.g. a `.tmp`
    /// renamed by a save in progress) is skipped; other failures are reported
    /// after trying the rest.
    pub(crate) fn clear(&self) -> Result<()> {
        remove_all(self.files().into_iter().map(|(path, _)| path))
    }
}

fn remove_all(paths: impl IntoIterator<Item = PathBuf>) -> Result<()> {
    let mut first_error = None;
    for path in paths {
        match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                first_error.get_or_insert(Err(e).with_context(|| format!("couldn't delete {}", path.display())));
            }
            _ => {}
        }
    }
    first_error.unwrap_or(Ok(()))
}

#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CacheUsage {
    pub files: usize,
    pub bytes: u64,
    /// Entries held in memory this session (normally also on disk; more than
    /// `files` when saving to disk isn't working).
    pub in_memory: usize,
}

/// Counts clears, so a download that started before a clear doesn't save its
/// result after it. Read `current()` before downloading; save only if it
/// hasn't changed. Check and `bump()` under the same lock as the memory cache.
#[derive(Default)]
pub(crate) struct Generation(AtomicU64);

impl Generation {
    pub(crate) fn current(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }

    pub(crate) fn bump(&self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clear_skips_missing_files_and_leaves_others() {
        let dir = std::env::temp_dir().join(format!("lb-cache-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let disk = DiskCache { dir: Some(dir.clone()) };
        disk.write("a.json", &1);
        disk.write("b.json", &2);
        std::fs::write(dir.join("keep.txt"), "x").unwrap();
        assert_eq!(disk.usage(0).files, 2);
        // A file that disappears between listing and deleting is skipped, and
        // the rest are still deleted.
        let mut listed: Vec<PathBuf> = disk.files().into_iter().map(|(p, _)| p).collect();
        listed.insert(0, dir.join("gone.json.tmp"));
        assert!(remove_all(listed).is_ok());
        assert_eq!(disk.usage(0), CacheUsage::default());
        assert!(dir.join("keep.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
