//! Viewing photos where they are on disk, without adding them to a project.

use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::exiftool::ExifTool;
use crate::pipeline::{self, Kind, Options, RAW_EXTENSIONS};
use crate::preview::largest_embedded_jpeg;

/// Formats the webview decodes itself; the original bytes are shown as they are.
const NATIVE: &[&str] = &["jpg", "jpeg", "jpe", "png", "gif", "webp", "avif", "bmp"];
/// WebKit on macOS also decodes these; elsewhere TIFF is converted and HEIC is not available.
const MAC_NATIVE: &[&str] = &["tif", "tiff", "heic", "heif"];
const TIFF: &[&str] = &["tif", "tiff"];
const HEIC: &[&str] = &["heic", "heif"];
const MAX_FILES: usize = 20_000;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewerFile {
    pub name: String,
    pub size: u64,
    pub modified_ms: u64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewerFolder {
    pub path: String,
    pub name: String,
    pub files: Vec<ViewerFile>,
    /// Index of the file that was opened, or 0 when a folder was opened.
    pub start: usize,
}

fn ext_of(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

pub fn is_viewable(path: &Path) -> bool {
    let ext = ext_of(path);
    [RAW_EXTENSIONS, NATIVE, MAC_NATIVE].iter().any(|list| list.contains(&ext.as_str()))
}

/// Finder-style order: case-insensitive, with runs of digits compared as numbers ("DSC_9" before "DSC_10").
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (a, b) = (a.to_lowercase(), b.to_lowercase());
    let (mut x, mut y) = (a.as_bytes(), b.as_bytes());
    loop {
        match (x.first(), y.first()) {
            (None, None) => return a.cmp(&b),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(p), Some(q)) if p.is_ascii_digit() && q.is_ascii_digit() => {
                let take = |s: &[u8]| s.iter().take_while(|c| c.is_ascii_digit()).count();
                let (n, m) = (take(x), take(y));
                let trim = |s: &[u8]| {
                    let z = s.iter().take_while(|&&c| c == b'0').count();
                    s[z..].to_vec()
                };
                let (dx, dy) = (trim(&x[..n]), trim(&y[..m]));
                let ord = dx.len().cmp(&dy.len()).then_with(|| dx.cmp(&dy));
                if ord != Ordering::Equal {
                    return ord;
                }
                x = &x[n..];
                y = &y[m..];
            }
            (Some(p), Some(q)) => {
                if p != q {
                    return p.cmp(q);
                }
                x = &x[1..];
                y = &y[1..];
            }
        }
    }
}

/// Lists the viewable photos in a folder. `target` may be the folder itself or one photo inside it.
pub fn list(target: &Path) -> Result<ViewerFolder, String> {
    let (dir, opened) = if target.is_dir() {
        (target.to_path_buf(), None)
    } else {
        let parent = target.parent().filter(|p| !p.as_os_str().is_empty()).ok_or("That file has no folder.")?;
        (parent.to_path_buf(), target.file_name().map(|n| n.to_string_lossy().into_owned()))
    };
    let mut files: Vec<ViewerFile> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("Could not read the folder: {e}"))?.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || !is_viewable(&path) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let modified_ms = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
        files.push(ViewerFile { name, size: meta.len(), modified_ms });
        if files.len() >= MAX_FILES {
            break;
        }
    }
    files.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    let start = opened.as_deref().and_then(|n| files.iter().position(|f| f.name == n)).unwrap_or(0);
    let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| dir.to_string_lossy().into_owned());
    Ok(ViewerFolder { path: dir.to_string_lossy().into_owned(), name, files, start })
}

/// Prepends an EXIF block carrying only `orientation`, so the webview rotates an embedded RAW preview itself.
pub fn with_orientation(jpeg: &[u8], orientation: u16) -> Vec<u8> {
    let mut seg = b"Exif\0\0".to_vec();
    seg.extend_from_slice(&[b'M', b'M', 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1]);
    seg.extend_from_slice(&orientation.to_be_bytes());
    seg.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
    let mut out = Vec::with_capacity(jpeg.len() + seg.len() + 4);
    out.extend_from_slice(&[0xff, 0xd8, 0xff, 0xe1]);
    out.extend_from_slice(&((seg.len() + 2) as u16).to_be_bytes());
    out.extend_from_slice(&seg);
    out.extend_from_slice(&jpeg[2..]);
    out
}

fn check(path: &Path) -> Result<String, String> {
    if !is_viewable(path) {
        return Err("Fovea cannot show this kind of file.".into());
    }
    Ok(ext_of(path))
}

/// Bytes the webview can display for one photo: the original for formats it decodes, the camera's embedded preview
/// for RAW (tagged with the RAW's orientation), and a converted JPEG for TIFF where the webview cannot decode it.
pub fn image(path: &Path, exiftool: &ExifTool) -> Result<Vec<u8>, String> {
    let ext = check(path)?;
    let read = || fs::read(path).map_err(|e| format!("Could not read the file: {e}"));
    if NATIVE.contains(&ext.as_str()) || (cfg!(target_os = "macos") && MAC_NATIVE.contains(&ext.as_str())) {
        return read();
    }
    if HEIC.contains(&ext.as_str()) {
        return Err("HEIC photos can only be shown on a Mac.".into());
    }
    let orientation = exiftool.read_tags(path).ok().and_then(|t| t.get("Orientation").and_then(|v| v.as_u64())).unwrap_or(1) as u8;
    if TIFF.contains(&ext.as_str()) {
        let (out, _) = pipeline::render(path, Kind::Tiff, orientation, Options { long_edge: 8192, thumb_edge: 64 })?;
        return Ok(out.asset);
    }
    let data = read()?;
    let j = largest_embedded_jpeg(&data).ok_or_else(|| {
        format!("This {} file has no embedded preview that can be shown, and full RAW decoding is not available yet.", ext.to_uppercase())
    })?;
    let jpeg = &data[j.offset..j.offset + j.length];
    Ok(if (2..=8).contains(&orientation) { with_orientation(jpeg, orientation as u16) } else { jpeg.to_vec() })
}

/// ExifTool tags for one photo, for camera data and focus points.
pub fn tags(path: &Path, exiftool: &ExifTool) -> Result<serde_json::Value, String> {
    check(path)?;
    exiftool.read_tags(path)
}

pub fn join(folder: &str, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name == ".." || name.contains('\0') {
        return Err(format!("Refused to open \"{name}\"."));
    }
    Ok(Path::new(folder).join(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_like_finder() {
        let mut v = vec!["DSC_10.NEF", "dsc_9.jpg", "DSC_009b.NEF", "a.png", "DSC_100.NEF"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(v, vec!["a.png", "dsc_9.jpg", "DSC_009b.NEF", "DSC_10.NEF", "DSC_100.NEF"]);
    }

    #[test]
    fn lists_every_viewable_format_and_finds_the_opened_file() {
        let dir = tempfile::tempdir().unwrap();
        for n in ["b.NEF", "a.jpg", "c.heic", "d.webp", "notes.txt", ".hidden.jpg", "e.CR3"] {
            fs::write(dir.path().join(n), b"x").unwrap();
        }
        fs::create_dir(dir.path().join("sub.jpg")).unwrap();
        let listed = list(&dir.path().join("d.webp")).unwrap();
        let names: Vec<&str> = listed.files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["a.jpg", "b.NEF", "c.heic", "d.webp", "e.CR3"]);
        assert_eq!(listed.start, 3);
        assert_eq!(list(dir.path()).unwrap().start, 0);
    }

    #[test]
    fn refuses_names_that_leave_the_folder() {
        assert!(join("/photos", "../secret.jpg").is_err());
        assert!(join("/photos", "a/b.jpg").is_err());
        assert!(join("/photos", "..").is_err());
        assert!(join("/photos", "a.jpg").is_ok());
    }

    #[test]
    fn serves_embedded_preview_with_orientation() {
        let dir = tempfile::tempdir().unwrap();
        let jpeg_path = dir.path().join("p.jpg");
        image::RgbImage::from_pixel(60, 40, image::Rgb([10, 20, 30])).save(&jpeg_path).unwrap();
        let preview = fs::read(&jpeg_path).unwrap();
        let mut raw = b"II*\0\x08\0\0\0".to_vec();
        raw.extend(vec![7u8; 2000]);
        raw.extend(&preview);
        let raw_path = dir.path().join("DSC_0001.NEF");
        fs::write(&raw_path, &raw).unwrap();
        let et = ExifTool::new(None);
        assert_eq!(image(&raw_path, &et).unwrap(), preview);

        let tagged = with_orientation(&preview, 6);
        let decoded = image::load_from_memory(&tagged).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (60, 40));
        assert_eq!(&tagged[..4], &[0xff, 0xd8, 0xff, 0xe1]);
        assert_eq!(&tagged[tagged.len() - preview.len() + 2..], &preview[2..]);
        assert!(image(&dir.path().join("notes.txt"), &et).is_err());
    }
}
