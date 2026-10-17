//! Reading an unzipped .fovea folder the user picked.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

const MAX_FILES: usize = 10_000;
const MAX_DEPTH: usize = 6;

#[derive(Debug, Serialize, PartialEq)]
pub struct FolderEntry {
    /// Path relative to the picked folder, always with "/" separators.
    pub path: String,
    pub size: u64,
}

pub fn list(root: &Path) -> Result<Vec<FolderEntry>, String> {
    if !root.is_dir() {
        return Err("That is not a folder.".into());
    }
    let mut out = Vec::new();
    walk(root, root, 0, &mut out)?;
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<FolderEntry>) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(|e| format!("Could not read folder: {e}"))?.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() {
            continue;
        }
        let path = entry.path();
        if kind.is_dir() {
            walk(root, &path, depth + 1, out)?;
        } else if kind.is_file() {
            if out.len() >= MAX_FILES {
                return Err(format!("The folder has more than {MAX_FILES} files. Choose the project folder itself."));
            }
            let rel = path.strip_prefix(root).map_err(|e| e.to_string())?;
            let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(FolderEntry { path: parts.join("/"), size });
        }
    }
    Ok(())
}

/// Resolves `rel` inside `root`, refusing anything that would escape it.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel.is_empty() || rel.contains('\0') || !rel_path.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("Refused to read \"{rel}\"."));
    }
    let base = fs::canonicalize(root).map_err(|e| format!("Could not open folder: {e}"))?;
    let full = fs::canonicalize(base.join(rel_path)).map_err(|e| format!("Could not read \"{rel}\": {e}"))?;
    if !full.starts_with(&base) {
        return Err(format!("Refused to read \"{rel}\" outside the chosen folder."));
    }
    Ok(full)
}

pub fn read(root: &Path, rel: &str) -> Result<Vec<u8>, String> {
    fs::read(resolve(root, rel)?).map_err(|e| format!("Could not read \"{rel}\": {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_nested_files_with_forward_slashes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Sal Forest");
        fs::create_dir_all(root.join("assets/images")).unwrap();
        fs::write(root.join("manifest.json"), b"{}").unwrap();
        fs::write(root.join("assets/images/a.jpg"), b"jpeg").unwrap();
        let listed = list(dir.path()).unwrap();
        assert_eq!(
            listed,
            vec![
                FolderEntry { path: "Sal Forest/assets/images/a.jpg".into(), size: 4 },
                FolderEntry { path: "Sal Forest/manifest.json".into(), size: 2 },
            ]
        );
        assert_eq!(read(dir.path(), "Sal Forest/assets/images/a.jpg").unwrap(), b"jpeg");
    }

    #[test]
    fn refuses_paths_outside_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let inner = dir.path().join("inner");
        fs::create_dir_all(&inner).unwrap();
        fs::write(dir.path().join("secret.txt"), b"x").unwrap();
        assert!(read(&inner, "../secret.txt").is_err());
        assert!(read(&inner, "/etc/passwd").is_err());
        assert!(read(&inner, "").is_err());
    }
}
