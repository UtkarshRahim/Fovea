mod exiftool;
mod folder;
mod pipeline;
mod preview;
mod storage;
mod viewer;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

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

/// Files the OS asked us to open (Finder "Open With", double-click, Explorer) that the UI has not picked up yet.
#[derive(Default)]
struct OpenRequests(Mutex<Vec<String>>);

fn queue_open(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Some(q) = app.try_state::<OpenRequests>() {
        q.0.lock().map(|mut v| v.extend(paths)).ok();
    }
    let _ = app.emit("open-requested", ());
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Command-line arguments that are files (Windows and Linux pass opened files this way).
fn file_args(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter().filter(|a| !a.starts_with('-') && std::path::Path::new(a).is_file()).collect()
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

#[tauri::command]
fn take_open_requests(requests: State<'_, OpenRequests>) -> Vec<String> {
    requests.0.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default()
}

#[tauri::command]
async fn viewer_list(path: String) -> Result<viewer::ViewerFolder, String> {
    tauri::async_runtime::spawn_blocking(move || viewer::list(&PathBuf::from(path))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn viewer_image(state: State<'_, AppState>, folder: String, name: String) -> Result<Response, String> {
    let et = state.exiftool.clone();
    let path = viewer::join(&folder, &name)?;
    tauri::async_runtime::spawn_blocking(move || viewer::image(&path, &et).map(Response::new)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn viewer_tags(state: State<'_, AppState>, folder: String, name: String) -> Result<serde_json::Value, String> {
    let et = state.exiftool.clone();
    let path = viewer::join(&folder, &name)?;
    tauri::async_runtime::spawn_blocking(move || viewer::tags(&path, &et)).await.map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(any(windows, target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| queue_open(app, file_args(argv.into_iter().skip(1)))));
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .manage(OpenRequests(Mutex::new(file_args(std::env::args().skip(1)))))
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
            cancel_import,
            take_open_requests,
            viewer_list,
            viewer_image,
            viewer_tags
        ])
        .build(tauri::generate_context!())
        .expect("error while building Frame Note");
    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            let paths = urls.into_iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect();
            queue_open(_app, paths);
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_percent_encoding() {
        assert_eq!(super::percent_decode("C%3A%5CUsers%5Cr%C3%A9mi%5Ca.jpg").unwrap(), "C:\\Users\\rémi\\a.jpg");
        assert_eq!(super::percent_decode("plain").unwrap(), "plain");
    }
}
