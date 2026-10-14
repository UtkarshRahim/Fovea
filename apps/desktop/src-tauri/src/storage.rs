use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub fn valid_assignment_id(id: &str) -> bool {
    id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Only `assets/images/<id>.jpg` and `assets/thumbnails/<id>.jpg` may be written.
pub fn valid_asset_path(p: &str) -> bool {
    let Some(rest) = p.strip_prefix("assets/images/").or_else(|| p.strip_prefix("assets/thumbnails/")) else {
        return false;
    };
    let Some(stem) = rest.strip_suffix(".jpg") else { return false };
    !stem.is_empty() && stem.len() <= 64 && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn dir(&self, id: &str) -> Result<PathBuf, String> {
        if !valid_assignment_id(id) {
            return Err("Invalid assignment id.".into());
        }
        Ok(self.root.join(id))
    }

    pub fn list(&self) -> Vec<String> {
        let Ok(entries) = fs::read_dir(&self.root) else { return vec![] };
        entries
            .filter_map(|e| e.ok())
            .filter(|e| valid_assignment_id(&e.file_name().to_string_lossy()))
            .filter_map(|e| fs::read_to_string(e.path().join("manifest.json")).ok())
            .collect()
    }

    pub fn read(&self, id: &str) -> Result<String, String> {
        fs::read_to_string(self.dir(id)?.join("manifest.json")).map_err(|_| "This assignment no longer exists on this computer.".into())
    }

    pub fn write(&self, id: &str, json: &str) -> Result<(), String> {
        let dir = self.dir(id)?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let tmp = dir.join("manifest.json.tmp");
        fs::write(&tmp, json).map_err(|e| format!("Could not save: {e}"))?;
        fs::rename(&tmp, dir.join("manifest.json")).map_err(|e| format!("Could not save: {e}"))
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let dir = self.dir(id)?;
        if dir.exists() {
            fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn write_asset(&self, id: &str, rel: &str, data: &[u8]) -> Result<(), String> {
        if !valid_asset_path(rel) {
            return Err(format!("Refused to write unexpected path {rel}"));
        }
        let path = self.dir(id)?.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(path, data).map_err(|e| e.to_string())
    }

    pub fn read_asset(&self, id: &str, rel: &str) -> Result<Vec<u8>, String> {
        if !valid_asset_path(rel) {
            return Err(format!("Invalid asset path {rel}"));
        }
        fs::read(self.dir(id)?.join(rel)).map_err(|_| format!("Missing stored image {rel}"))
    }

    /// Deletes stored assets no longer referenced by the manifest.
    pub fn gc(&self, id: &str, keep: &[String]) -> Result<usize, String> {
        let dir = self.dir(id)?;
        let keep: HashSet<&str> = keep.iter().map(String::as_str).collect();
        let mut removed = 0;
        for sub in ["assets/images", "assets/thumbnails"] {
            let Ok(entries) = fs::read_dir(dir.join(sub)) else { continue };
            for e in entries.filter_map(|e| e.ok()) {
                let rel = format!("{sub}/{}", e.file_name().to_string_lossy());
                if !keep.contains(rel.as_str()) && fs::remove_file(e.path()).is_ok() {
                    removed += 1;
                }
            }
        }
        Ok(removed)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_bad_ids_and_paths() {
        assert!(valid_assignment_id("0b8f6f3e-8f0a-4d5e-9a63-6c1f2f8f9a10"));
        assert!(!valid_assignment_id("../../etc"));
        assert!(valid_asset_path("assets/images/img-abc123.jpg"));
        for bad in ["assets/images/../x.jpg", "/etc/passwd", "assets/other/a.jpg", "assets/images/a.png", "assets/images/.jpg", "assets\\images\\a.jpg"] {
            assert!(!valid_asset_path(bad), "{bad}");
        }
    }

    #[test]
    fn write_read_gc_delete() {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::new(dir.path().to_path_buf());
        let id = "0b8f6f3e-8f0a-4d5e-9a63-6c1f2f8f9a10";
        s.write(id, "{\"a\":1}").unwrap();
        assert_eq!(s.read(id).unwrap(), "{\"a\":1}");
        assert_eq!(s.list().len(), 1);
        s.write_asset(id, "assets/images/img-1.jpg", b"1").unwrap();
        s.write_asset(id, "assets/images/img-2.jpg", b"2").unwrap();
        assert!(s.write_asset(id, "../escape.jpg", b"x").is_err());
        assert_eq!(s.gc(id, &["assets/images/img-1.jpg".into()]).unwrap(), 1);
        assert_eq!(s.read_asset(id, "assets/images/img-1.jpg").unwrap(), b"1");
        s.delete(id).unwrap();
        assert!(s.read(id).is_err());
    }
}
