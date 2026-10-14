use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::UNIX_EPOCH;

use fast_image_resize::{images::Image as FirImage, FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use image::codecs::jpeg::JpegEncoder;
use image::metadata::Orientation;
use image::{DynamicImage, ExtendedColorType, ImageFormat, ImageReader};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::exiftool::ExifTool;
use crate::preview::largest_embedded_jpeg;

pub const RAW_EXTENSIONS: &[&str] = &["nef", "nrw", "cr2", "cr3", "arw", "srf", "sr2", "dng", "raf", "orf", "rw2", "pef"];
pub const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "tif", "tiff"];

#[derive(Debug, Clone, Copy)]
pub struct Options {
    pub long_edge: u32,
    pub thumb_edge: u32,
}

impl Default for Options {
    fn default() -> Self {
        Self { long_edge: 4096, thumb_edge: 512 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Processed {
    pub id: String,
    pub original_filename: String,
    pub asset_source: String,
    pub asset_sha256: String,
    pub thumbnail_sha256: String,
    pub asset_width: u32,
    pub asset_height: u32,
    pub tags: serde_json::Value,
    pub metadata_warning: Option<String>,
    #[serde(default)]
    pub from_cache: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Failure {
    pub file: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub processed: Vec<Processed>,
    pub failures: Vec<Failure>,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Jpeg,
    Png,
    Tiff,
    Raw,
}

fn ext_of(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn detect_kind(path: &Path, head: &[u8]) -> Result<Kind, String> {
    let ext = ext_of(path);
    if RAW_EXTENSIONS.contains(&ext.as_str()) {
        return Ok(Kind::Raw);
    }
    if head.starts_with(&[0xff, 0xd8]) {
        return Ok(Kind::Jpeg);
    }
    if head.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Ok(Kind::Png);
    }
    if head.len() >= 12 && &head[4..11] == b"ftypcrx" {
        return Ok(Kind::Raw);
    }
    if head.len() >= 12 && (&head[4..12] == b"ftypheic" || &head[4..12] == b"ftypheix" || &head[4..12] == b"ftypmif1") {
        return Err("HEIC files are not supported yet. Export them as JPEG first.".into());
    }
    if head.starts_with(b"II*\0") || head.starts_with(b"MM\0*") {
        return Ok(if ext == "tif" || ext == "tiff" { Kind::Tiff } else { Kind::Raw });
    }
    Err("This file type is not supported. Use JPEG, PNG, TIFF or a camera RAW file (NEF, CR2, CR3, ARW).".into())
}

pub fn is_supported_name(path: &Path) -> bool {
    let ext = ext_of(path);
    RAW_EXTENSIONS.contains(&ext.as_str()) || IMAGE_EXTENSIONS.contains(&ext.as_str())
}

/// Lists supported image files directly inside `dir` (not recursive), sorted by name.
pub fn scan_folder(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut out: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|e| format!("Could not read folder: {e}"))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && is_supported_name(p))
        .filter(|p| !p.file_name().map(|n| n.to_string_lossy().starts_with("._")).unwrap_or(false))
        .collect();
    out.sort_by_key(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()));
    Ok(out)
}

fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

pub fn cache_key(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| format!("Could not read file: {e}"))?;
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0);
    let abs = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    Ok(sha256_hex(format!("{}|{}|{}", abs.to_string_lossy(), meta.len(), mtime).as_bytes())[..32].to_string())
}

fn new_image_id() -> String {
    format!("img-{}", &uuid::Uuid::new_v4().simple().to_string()[..16])
}

fn resize_rgb(img: &image::RgbImage, long_edge: u32) -> Result<image::RgbImage, String> {
    let (w, h) = img.dimensions();
    let scale = (long_edge as f64 / w.max(h) as f64).min(1.0);
    let (dw, dh) = (((w as f64 * scale).round() as u32).max(1), ((h as f64 * scale).round() as u32).max(1));
    if (dw, dh) == (w, h) {
        return Ok(img.clone());
    }
    let src = FirImage::from_vec_u8(w, h, img.as_raw().clone(), PixelType::U8x3).map_err(|e| e.to_string())?;
    let mut dst = FirImage::new(dw, dh, PixelType::U8x3);
    Resizer::new()
        .resize(&src, &mut dst, &ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3)))
        .map_err(|e| e.to_string())?;
    image::RgbImage::from_raw(dw, dh, dst.into_vec()).ok_or_else(|| "resize produced an invalid buffer".into())
}

fn encode_jpeg(img: &image::RgbImage, quality: u8) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, quality)
        .encode(img.as_raw(), img.width(), img.height(), ExtendedColorType::Rgb8)
        .map_err(|e| format!("Could not encode JPEG: {e}"))?;
    Ok(out)
}

fn decode(path: &Path, kind: Kind) -> Result<(DynamicImage, &'static str), String> {
    let ext = ext_of(path).to_uppercase();
    match kind {
        Kind::Raw => {
            let data = fs::read(path).map_err(|e| format!("Could not read file: {e}"))?;
            let j = largest_embedded_jpeg(&data).ok_or_else(|| {
                format!("No usable embedded preview was found in this {ext} file, and full RAW decoding is not available in this version.")
            })?;
            let img = image::load_from_memory_with_format(&data[j.offset..j.offset + j.length], ImageFormat::Jpeg)
                .map_err(|e| format!("The embedded preview in this {ext} file could not be decoded: {e}"))?;
            Ok((img, "embedded-preview"))
        }
        Kind::Jpeg | Kind::Png | Kind::Tiff => {
            let reader = ImageReader::open(path).map_err(|e| format!("Could not open file: {e}"))?.with_guessed_format().map_err(|e| e.to_string())?;
            let img = reader.decode().map_err(|e| format!("This {ext} file could not be decoded: {e}"))?;
            Ok((
                img,
                match kind {
                    Kind::Jpeg => "original-jpeg",
                    Kind::Png => "original-png",
                    _ => "tiff-converted",
                },
            ))
        }
    }
}

struct Outputs {
    asset: Vec<u8>,
    thumb: Vec<u8>,
    width: u32,
    height: u32,
}

fn render(path: &Path, kind: Kind, orientation: u8, opts: Options) -> Result<(Outputs, &'static str), String> {
    let (mut img, source) = decode(path, kind)?;
    if let Some(o) = Orientation::from_exif(orientation) {
        img.apply_orientation(o);
    }
    let rgb = img.into_rgb8();
    let asset_img = resize_rgb(&rgb, opts.long_edge)?;
    drop(rgb);
    let thumb_img = resize_rgb(&asset_img, opts.thumb_edge)?;
    Ok((
        Outputs {
            asset: encode_jpeg(&asset_img, 90)?,
            thumb: encode_jpeg(&thumb_img, 80)?,
            width: asset_img.width(),
            height: asset_img.height(),
        },
        source,
    ))
}

fn write_outputs(assignment_dir: &Path, id: &str, asset: &[u8], thumb: &[u8]) -> Result<(), String> {
    let images = assignment_dir.join("assets").join("images");
    let thumbs = assignment_dir.join("assets").join("thumbnails");
    fs::create_dir_all(&images).and_then(|_| fs::create_dir_all(&thumbs)).map_err(|e| e.to_string())?;
    fs::write(images.join(format!("{id}.jpg")), asset).map_err(|e| e.to_string())?;
    fs::write(thumbs.join(format!("{id}.jpg")), thumb).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn process_file(path: &Path, assignment_dir: &Path, cache_dir: &Path, exiftool: &ExifTool, opts: Options) -> Result<Processed, String> {
    let original_filename = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let key = cache_key(path)?;
    let cdir = cache_dir.join(&key);
    let id = new_image_id();

    if let (Ok(info), Ok(asset), Ok(thumb)) = (
        fs::read(cdir.join("info.json")),
        fs::read(cdir.join("asset.jpg")),
        fs::read(cdir.join("thumb.jpg")),
    ) {
        if let Ok(mut p) = serde_json::from_slice::<Processed>(&info) {
            if sha256_hex(&asset) == p.asset_sha256 && sha256_hex(&thumb) == p.thumbnail_sha256 {
                write_outputs(assignment_dir, &id, &asset, &thumb)?;
                p.id = id;
                p.original_filename = original_filename;
                p.from_cache = true;
                return Ok(p);
            }
        }
    }

    let mut head = [0u8; 16];
    {
        use std::io::Read;
        let mut f = fs::File::open(path).map_err(|e| format!("Could not open file: {e}"))?;
        let n = f.read(&mut head).map_err(|e| e.to_string())?;
        if n < 4 {
            return Err("The file is empty or truncated.".into());
        }
    }
    let kind = detect_kind(path, &head)?;
    let (tags, metadata_warning) = match exiftool.read_tags(path) {
        Ok(t) => (t, None),
        Err(e) => (serde_json::json!({}), Some(e)),
    };
    let orientation = tags.get("Orientation").and_then(|v| v.as_u64()).unwrap_or(1) as u8;
    let (out, source) = render(path, kind, orientation, opts)?;

    let processed = Processed {
        id: id.clone(),
        original_filename,
        asset_source: source.into(),
        asset_sha256: sha256_hex(&out.asset),
        thumbnail_sha256: sha256_hex(&out.thumb),
        asset_width: out.width,
        asset_height: out.height,
        tags,
        metadata_warning,
        from_cache: false,
    };
    write_outputs(assignment_dir, &id, &out.asset, &out.thumb)?;

    if processed.metadata_warning.is_none() && fs::create_dir_all(&cdir).is_ok() {
        let _ = fs::write(cdir.join("asset.jpg"), &out.asset);
        let _ = fs::write(cdir.join("thumb.jpg"), &out.thumb);
        let _ = fs::write(cdir.join("info.json"), serde_json::to_vec(&processed).unwrap_or_default());
    }
    Ok(processed)
}

pub fn import_all(
    paths: &[PathBuf],
    assignment_dir: &Path,
    cache_dir: &Path,
    exiftool: &ExifTool,
    opts: Options,
    cancel: &AtomicBool,
    progress: &(dyn Fn(usize, usize, &str) + Sync),
) -> ImportResult {
    let mut unique: Vec<PathBuf> = Vec::new();
    let mut failures = Vec::new();
    for p in paths {
        let canon = fs::canonicalize(p).unwrap_or_else(|_| p.clone());
        if unique.iter().any(|u| fs::canonicalize(u).unwrap_or_else(|_| u.clone()) == canon) {
            failures.push(Failure { file: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), message: "Skipped: selected twice.".into() });
        } else {
            unique.push(p.clone());
        }
    }
    let total = unique.len();
    let done = AtomicUsize::new(0);
    progress(0, total, "");
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).clamp(1, 4);
    let pool = rayon::ThreadPoolBuilder::new().num_threads(threads).build().expect("thread pool");
    let results: Vec<(usize, Result<Processed, Failure>)> = pool.install(|| {
        unique
            .par_iter()
            .enumerate()
            .filter_map(|(i, p)| {
                if cancel.load(Ordering::Relaxed) {
                    return None;
                }
                let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| process_file(p, assignment_dir, cache_dir, exiftool, opts)))
                    .unwrap_or_else(|_| Err("Unexpected error while reading this file.".into()))
                    .map_err(|message| Failure { file: name.clone(), message });
                let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                progress(n, total, &name);
                Some((i, r))
            })
            .collect()
    });
    let mut sorted = results;
    sorted.sort_by_key(|(i, _)| *i);
    let mut processed = Vec::new();
    for (_, r) in sorted {
        match r {
            Ok(p) => processed.push(p),
            Err(f) => failures.push(f),
        }
    }
    ImportResult { processed, failures, cancelled: cancel.load(Ordering::Relaxed) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_jpeg(path: &Path, w: u32, h: u32) {
        let img = image::RgbImage::from_fn(w, h, |x, y| image::Rgb([(x % 255) as u8, (y % 255) as u8, 90]));
        img.save(path).unwrap();
    }

    #[test]
    fn imports_jpeg_and_uses_cache() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("Z9_0001.jpg");
        write_jpeg(&src, 1200, 800);
        let out = dir.path().join("a");
        let cache = dir.path().join("cache");
        let et = ExifTool::new(crate::exiftool::locate(None));
        let opts = Options { long_edge: 600, thumb_edge: 100 };
        let first = process_file(&src, &out, &cache, &et, opts).unwrap();
        assert_eq!((first.asset_width, first.asset_height), (600, 400));
        assert_eq!(first.asset_source, "original-jpeg");
        assert!(!first.from_cache);
        assert!(out.join("assets/images").join(format!("{}.jpg", first.id)).is_file());
        if et.available() {
            let second = process_file(&src, &out, &cache, &et, opts).unwrap();
            assert!(second.from_cache);
            assert_ne!(second.id, first.id);
            assert_eq!(second.asset_sha256, first.asset_sha256);
        }
    }

    #[test]
    fn extracts_embedded_preview_from_raw_container() {
        let dir = tempfile::tempdir().unwrap();
        let jpeg_path = dir.path().join("p.jpg");
        write_jpeg(&jpeg_path, 900, 600);
        let preview = fs::read(&jpeg_path).unwrap();
        let mut raw = b"II*\0\x08\0\0\0".to_vec();
        raw.extend(vec![7u8; 4000]);
        raw.extend(&preview);
        raw.extend(vec![3u8; 4000]);
        let raw_path = dir.path().join("DSC_0001.NEF");
        fs::write(&raw_path, raw).unwrap();
        let et = ExifTool::new(None);
        let p = process_file(&raw_path, &dir.path().join("a"), &dir.path().join("c"), &et, Options::default()).unwrap();
        assert_eq!(p.asset_source, "embedded-preview");
        assert_eq!((p.asset_width, p.asset_height), (900, 600));
        assert!(p.metadata_warning.is_some());
    }

    #[test]
    fn partial_failures_do_not_abort_batch() {
        let dir = tempfile::tempdir().unwrap();
        let good = dir.path().join("good.jpg");
        write_jpeg(&good, 300, 200);
        let corrupt = dir.path().join("corrupt.jpg");
        fs::write(&corrupt, [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).unwrap();
        let raw_without_preview = dir.path().join("empty.CR3");
        fs::write(&raw_without_preview, vec![0u8; 2048]).unwrap();
        let et = ExifTool::new(None);
        let cancel = AtomicBool::new(false);
        let r = import_all(
            &[good.clone(), corrupt, raw_without_preview, good],
            &dir.path().join("a"),
            &dir.path().join("c"),
            &et,
            Options::default(),
            &cancel,
            &|_, _, _| {},
        );
        assert_eq!(r.processed.len(), 1);
        assert_eq!(r.failures.len(), 3);
        assert!(r.failures.iter().any(|f| f.message.contains("selected twice")));
        assert!(r.failures.iter().any(|f| f.message.contains("embedded preview")));
    }

    #[test]
    fn applies_orientation() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("rot.jpg");
        write_jpeg(&src, 300, 200);
        let (out, _) = render(&src, Kind::Jpeg, 6, Options::default()).unwrap();
        assert_eq!((out.width, out.height), (200, 300));
    }

    #[test]
    fn scan_folder_filters_and_sorts() {
        let dir = tempfile::tempdir().unwrap();
        for n in ["b.NEF", "a.jpg", "notes.txt", "._a.jpg", "C.cr3"] {
            fs::write(dir.path().join(n), b"x").unwrap();
        }
        let names: Vec<String> = scan_folder(dir.path()).unwrap().iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["a.jpg", "b.NEF", "C.cr3"]);
    }
}
