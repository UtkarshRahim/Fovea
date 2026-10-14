mod exiftool;
mod folder;
mod pipeline;
mod preview;
mod storage;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};

use exiftool::ExifTool;
use pipeline::{ImportResult, Options};
use storage::Store;

struct AppState {
    store: Store,
    cache_dir: PathBuf,
    exiftool: Arc<ExifTool>,
    cancel: Arc<AtomicBool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    exiftool: String,
    exiftool_available: bool,
    data_dir: String,
}

#[derive(Clone, Serialize)]
struct Progress {
    done: usize,
    total: usize,
    current: String,
}

fn header(req: &Request<'_>, name: &str) -> Result<String, String> {
    let raw = req.headers().get(name).and_then(|v| v.to_str().ok()).ok_or_else(|| format!("missing header {name}"))?;
    percent_decode(raw)
}

fn percent_decode(s: &str) -> Result<String, String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let h = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|e| e.to_string())?;
            out.push(u8::from_str_radix(h, 16).map_err(|e| e.to_string())?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|e| e.to_string())
}

fn raw_body<'a>(req: &'a Request<'_>) -> Result<&'a [u8], String> {
    match req.body() {
        InvokeBody::Raw(data) => Ok(data),
        _ => Err("expected a binary body".into()),
    }
}

#[tauri::command]
fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        exiftool: state.exiftool.description(),
        exiftool_available: state.exiftool.available(),
        data_dir: state.store.root().to_string_lossy().into_owned(),
    }
}

#[tauri::command]
fn list_manifests(state: State<'_, AppState>) -> Vec<String> {
    state.store.list()
}

#[tauri::command]
fn read_manifest(state: State<'_, AppState>, id: String) -> Result<String, String> {
    state.store.read(&id)
}

#[tauri::command]
fn write_manifest(state: State<'_, AppState>, id: String, json: String) -> Result<(), String> {
    state.store.write(&id, &json)
}

#[tauri::command]
fn delete_assignment(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.store.delete(&id)
}

#[tauri::command]
fn assignment_dir(state: State<'_, AppState>, id: String) -> Result<String, String> {
    Ok(state.store.dir(&id)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn gc_assets(state: State<'_, AppState>, id: String, keep: Vec<String>) -> Result<usize, String> {
    state.store.gc(&id, &keep)
}

#[tauri::command]
fn write_asset(state: State<'_, AppState>, request: Request<'_>) -> Result<(), String> {
    let id = header(&request, "x-assignment-id")?;
    let path = header(&request, "x-asset-path")?;
    state.store.write_asset(&id, &path, raw_body(&request)?)
}

#[tauri::command]
fn read_asset(state: State<'_, AppState>, id: String, path: String) -> Result<Response, String> {
    Ok(Response::new(state.store.read_asset(&id, &path)?))
}

/// Reads a file the user picked in an open dialog (used for .framenote import).
#[tauri::command]
async fn read_file(path: String) -> Result<Response, String> {
    if !path.to_lowercase().ends_with(".framenote") && !path.to_lowercase().ends_with(".zip") {
        return Err("Only .framenote files can be opened here.".into());
    }
    tauri::async_runtime::spawn_blocking(move || std::fs::read(&path).map(Response::new).map_err(|e| format!("Could not read the file: {e}")))
        .await
        .map_err(|e| e.to_string())?
}

/// Writes bytes to a path the user chose in a save dialog.
#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let path = header(&request, "x-path")?;
    let lower = path.to_lowercase();
    if ![".framenote", ".jpg", ".jpeg", ".png"].iter().any(|e| lower.ends_with(e)) {
        return Err("Refused to write a file with an unexpected extension.".into());
    }
    std::fs::write(&path, raw_body(&request)?).map_err(|e| format!("Could not save the file: {e}"))
}

#[tauri::command]
fn list_folder(path: String) -> Result<Vec<folder::FolderEntry>, String> {
    folder::list(&PathBuf::from(path))
}

/// Reads one file inside a folder the user picked (used for importing an unzipped project).
#[tauri::command]
async fn read_folder_file(root: String, path: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || folder::read(&PathBuf::from(root), &path).map(Response::new))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn scan_folder(path: String) -> Result<Vec<String>, String> {
    Ok(pipeline::scan_folder(&PathBuf::from(path))?.into_iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

#[tauri::command]
async fn import_images(app: AppHandle, state: State<'_, AppState>, id: String, paths: Vec<String>) -> Result<ImportResult, String> {
    let dir = state.store.dir(&id)?;
    let cache = state.cache_dir.clone();
    let et = state.exiftool.clone();
    let cancel = state.cancel.clone();
    cancel.store(false, Ordering::Relaxed);
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tauri::async_runtime::spawn_blocking(move || {
        let emit = |done: usize, total: usize, current: &str| {
            let _ = app.emit("import-progress", Progress { done, total, current: current.to_string() });
        };
        pipeline::import_all(&paths, &dir, &cache, &et, Options::default(), &cancel, &emit)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn cancel_import(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::Relaxed);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            let root = data.join("assignments");
            std::fs::create_dir_all(&root)?;
            let cache_dir = app.path().app_cache_dir().unwrap_or_else(|_| data.join("cache")).join("previews");
            std::fs::create_dir_all(&cache_dir)?;
            let launcher = exiftool::locate(app.path().resource_dir().ok().as_deref());
            app.manage(AppState {
                store: Store::new(root),
                cache_dir,
                exiftool: Arc::new(ExifTool::new(launcher)),
                cancel: Arc::new(AtomicBool::new(false)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            list_manifests,
            read_manifest,
            write_manifest,
            delete_assignment,
            assignment_dir,
            gc_assets,
            write_asset,
            read_asset,
            read_file,
            write_file,
            scan_folder,
            list_folder,
            read_folder_file,
            import_images,
            cancel_import
        ])
        .run(tauri::generate_context!())
        .expect("error while running Frame Note");
}

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_percent_encoding() {
        assert_eq!(super::percent_decode("C%3A%5CUsers%5Cr%C3%A9mi%5Ca.jpg").unwrap(), "C:\\Users\\rémi\\a.jpg");
        assert_eq!(super::percent_decode("plain").unwrap(), "plain");
    }
}
