//! One long-lived ExifTool process (`-stay_open True -@ -`), shared by all import workers.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

pub const TAGS: &[&str] = &[
    "Make", "Model", "LensModel", "LensMake", "LensID", "LensType", "Lens", "LensInfo", "FNumber",
    "ExposureTime", "ISO", "FocalLength", "ExposureCompensation", "DateTimeOriginal", "CreateDate",
    "ImageSize", "Orientation", "GPSLatitude", "GPSLongitude", "GPSLatitudeRef", "GPSLongitudeRef",
    "SerialNumber", "Software", "MIMEType",
];

#[derive(Debug, Clone)]
pub struct Launcher {
    pub program: PathBuf,
    pub prefix_args: Vec<String>,
    pub description: String,
}

/// Bundled copy first (macOS: Perl script run by the system Perl; Windows: standalone exe),
/// then `FRAMENOTE_EXIFTOOL`, then `exiftool` on PATH.
pub fn locate(resource_dir: Option<&Path>) -> Option<Launcher> {
    if let Some(dir) = resource_dir {
        let root = dir.join("exiftool");
        let exe = root.join("exiftool.exe");
        if cfg!(windows) && exe.is_file() {
            return Some(Launcher { program: exe, prefix_args: vec![], description: "bundled ExifTool".into() });
        }
        let script = root.join("exiftool");
        if !cfg!(windows) && script.is_file() {
            return Some(Launcher {
                program: PathBuf::from("/usr/bin/perl"),
                prefix_args: vec![script.to_string_lossy().into_owned()],
                description: "bundled ExifTool".into(),
            });
        }
    }
    if let Ok(p) = std::env::var("FRAMENOTE_EXIFTOOL") {
        return Some(Launcher { program: PathBuf::from(p), prefix_args: vec![], description: "ExifTool from FRAMENOTE_EXIFTOOL".into() });
    }
    let name = if cfg!(windows) { "exiftool.exe" } else { "exiftool" };
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).map(|d| d.join(name)).find(|p| p.is_file()).map(|program| Launcher {
            program,
            prefix_args: vec![],
            description: "ExifTool from PATH".into(),
        })
    })
}

struct Process {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Process {
    fn spawn(l: &Launcher) -> std::io::Result<Self> {
        let mut cmd = Command::new(&l.program);
        cmd.args(&l.prefix_args)
            .args(["-stay_open", "True", "-@", "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let mut child = cmd.spawn()?;
        let stdin = child.stdin.take().ok_or_else(|| std::io::Error::other("no stdin"))?;
        let stdout = BufReader::new(child.stdout.take().ok_or_else(|| std::io::Error::other("no stdout"))?);
        Ok(Self { child, stdin, stdout })
    }

    fn run(&mut self, args: &[String]) -> std::io::Result<String> {
        for a in args {
            if a.contains('\n') {
                return Err(std::io::Error::other("argument contains a newline"));
            }
            writeln!(self.stdin, "{a}")?;
        }
        writeln!(self.stdin, "-execute")?;
        self.stdin.flush()?;
        let mut out = String::new();
        loop {
            let mut line = String::new();
            if self.stdout.read_line(&mut line)? == 0 {
                return Err(std::io::Error::other("ExifTool exited unexpectedly"));
            }
            if line.trim_end() == "{ready}" {
                return Ok(out);
            }
            out.push_str(&line);
        }
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = writeln!(self.stdin, "-stay_open\nFalse");
        let _ = self.stdin.flush();
        let _ = self.child.wait();
    }
}

pub struct ExifTool {
    launcher: Option<Launcher>,
    proc: Mutex<Option<Process>>,
}

impl ExifTool {
    pub fn new(launcher: Option<Launcher>) -> Self {
        Self { launcher, proc: Mutex::new(None) }
    }

    pub fn available(&self) -> bool {
        self.launcher.is_some()
    }

    pub fn description(&self) -> String {
        self.launcher.as_ref().map(|l| l.description.clone()).unwrap_or_else(|| "not found".into())
    }

    /// Returns ExifTool's `-json -n` object for one file.
    pub fn read_tags(&self, path: &Path) -> Result<serde_json::Value, String> {
        let launcher = self.launcher.as_ref().ok_or("ExifTool is not available, so camera metadata could not be read.")?;
        let mut args: Vec<String> = vec!["-json".into(), "-n".into(), "-charset".into(), "filename=utf8".into()];
        args.extend(TAGS.iter().map(|t| format!("-{t}")));
        args.push(path.to_string_lossy().into_owned());

        let mut guard = self.proc.lock().map_err(|_| "ExifTool lock poisoned")?;
        for attempt in 0..2 {
            if guard.is_none() {
                *guard = Some(Process::spawn(launcher).map_err(|e| format!("Could not start ExifTool: {e}"))?);
            }
            match guard.as_mut().unwrap().run(&args) {
                Ok(out) => {
                    let v: serde_json::Value = serde_json::from_str(out.trim()).map_err(|_| "ExifTool returned no metadata for this file.".to_string())?;
                    return v.as_array().and_then(|a| a.first().cloned()).ok_or_else(|| "ExifTool returned no metadata for this file.".into());
                }
                Err(e) if attempt == 0 => {
                    *guard = None;
                    let _ = e;
                }
                Err(e) => return Err(format!("ExifTool failed: {e}")),
            }
        }
        unreachable!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_tags_when_exiftool_is_installed() {
        let Some(l) = locate(None) else {
            eprintln!("exiftool not on PATH; skipping");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.jpg");
        let img = image::RgbImage::from_pixel(64, 48, image::Rgb([120, 90, 60]));
        img.save(&path).unwrap();
        let et = ExifTool::new(Some(l));
        let tags = et.read_tags(&path).unwrap();
        assert_eq!(tags["ImageSize"].as_str().unwrap().replace('x', " "), "64 48");
        let again = et.read_tags(&path).unwrap();
        assert_eq!(tags, again);
    }
}
