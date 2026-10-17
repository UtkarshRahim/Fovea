import { useState, type FormEvent } from "react";
import { Replace, Trash2 } from "lucide-react";
import {
  formatAperture,
  formatCamera,
  formatCaptureDate,
  formatExposureCompensation,
  formatFocalLength,
  formatIso,
  formatLens,
  formatOriginalSize,
  formatShutterSpeed,
  type Comment,
  type ImageEntry,
  type UserNotes,
} from "@fovea/core";
import { Button, IconButton } from "./primitives";

const SOURCE_LABEL: Record<ImageEntry["assetSource"], string> = {
  "embedded-preview": "Camera's embedded preview (not a full RAW render)",
  "raw-decoded": "Decoded from RAW",
  "original-jpeg": "Original JPEG",
  "tiff-converted": "Converted from TIFF",
  "original-png": "Original PNG",
};

export function NotesSection({ image, onChange }: { image: ImageEntry; onChange: (patch: Partial<UserNotes>) => void }) {
  return (
    <section className="panel-section" aria-labelledby="notes-h">
      <h2 id="notes-h" className="section-title">
        Your notes
      </h2>
      <label className="field">
        <span>Caption</span>
        <textarea
          rows={3}
          value={image.user.caption ?? ""}
          placeholder="What should people notice in this photograph?"
          onChange={(e) => onChange({ caption: e.target.value })}
        />
      </label>
      <div className="field-pair">
        <label className="field">
          <span>Species</span>
          <input value={image.user.species ?? ""} placeholder="e.g. Bengal tiger" onChange={(e) => onChange({ species: e.target.value })} />
        </label>
        <label className="field">
          <span>Location</span>
          <input value={image.user.location ?? ""} placeholder="e.g. Bandhavgarh" onChange={(e) => onChange({ location: e.target.value })} />
        </label>
      </div>
    </section>
  );
}

export function CameraSection({ image, onReplace, replacing }: { image: ImageEntry; onReplace?: () => void; replacing?: boolean }) {
  const e = image.exposure;
  const rows: [string, string | undefined][] = [
    ["Focal length", formatFocalLength(e?.focalLengthMm)],
    ["Aperture", formatAperture(e?.aperture)],
    ["Shutter", formatShutterSpeed(e?.shutterSpeedSeconds)],
    ["ISO", formatIso(e?.iso)],
    ["Body", formatCamera(image)],
    ["Lens", formatLens(image)],
    ["Exp. comp.", formatExposureCompensation(e?.exposureCompensationEv)],
    ["Captured", formatCaptureDate(image.capturedAt)],
    ["Original size", formatOriginalSize(image)],
    ["GPS", image.gps ? "Present (stripped from exports by default)" : undefined],
  ];
  const present = rows.filter(([, v]) => v);
  return (
    <section className="panel-section" aria-labelledby="camera-h">
      <h2 id="camera-h" className="section-title">
        Camera data <span className="muted">— read only</span>
      </h2>
      {present.length ? (
        <dl className="kv">
          {present.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="mono">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted small">No camera metadata was found in this file. Nothing is filled in on your behalf.</p>
      )}
      <p className="muted small source-line">
        <span className="mono">{image.originalFilename}</span>
        <br />
        Shown from: {SOURCE_LABEL[image.assetSource]}
      </p>
      {onReplace ? (
        <div className="replace-row">
          <Button size="sm" onClick={onReplace} disabled={replacing} title="Use a different file for this photo. Notes and comments stay.">
            <Replace size={14} /> Replace image…
          </Button>
          <p className="muted small">Swaps in a new file and its camera data. Notes, comments and order stay as they are.</p>
        </div>
      ) : null}
    </section>
  );
}

export function CommentsSection({
  comments,
  onAdd,
  onDelete,
  authorName,
  onAuthorName,
}: {
  comments: Comment[];
  onAdd: (text: string) => void;
  onDelete: (id: string) => void;
  authorName: string;
  onAuthorName: (v: string) => void;
}) {
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd(text);
    setText("");
  };
  return (
    <section className="panel-section" aria-labelledby="comments-h">
      <h2 id="comments-h" className="section-title">
        Review comments <span className="muted">{comments.length ? `(${comments.length})` : ""}</span>
      </h2>
      {comments.length ? (
        <ul className="comments">
          {comments.map((c) => (
            <li key={c.id}>
              <div className="comment-meta">
                <span>{c.author || "Anonymous"}</span>
                <time className="muted mono" dateTime={c.createdAt}>
                  {new Date(c.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                </time>
                <IconButton label="Delete comment" onClick={() => onDelete(c.id)}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
              <p>{c.text}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No comments yet. Anyone reviewing this project can leave one.</p>
      )}
      <form className="comment-form" onSubmit={submit}>
        <label className="field">
          <span>Your name (optional)</span>
          <input value={authorName} onChange={(e) => onAuthorName(e.target.value)} placeholder="Shown with your comments" />
        </label>
        <label className="field">
          <span>Comment</span>
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Composition, timing, light…" />
        </label>
        <Button type="submit" size="sm" disabled={!text.trim()}>
          Add comment
        </Button>
      </form>
    </section>
  );
}
