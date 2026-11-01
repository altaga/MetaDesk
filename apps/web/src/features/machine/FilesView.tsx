"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { FileContent, FileEntry, FileListing } from "@/shared/types";

function joinPath(base: string, name: string): string {
  return base === "." || base === "" ? name : `${base}/${name}`;
}

function parentPath(path: string): string | null {
  if (path === "." || path === "") return null;
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "." : path.slice(0, cut);
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Folders first, then names A–Z the way a person reads them. */
function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort(
    (a, b) =>
      Number(b.type === "dir") - Number(a.type === "dir") ||
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );
}

/** The board decodes with replacement characters, so binary arrives as noise. */
function looksBinary(content: string): boolean {
  if (content.includes("\u0000")) return true;
  const replaced = content.match(/�/g)?.length ?? 0;
  return content.length > 0 && replaced / content.length > 0.1;
}

/** `docs/deep` → [["/", "."], ["docs", "docs"], ["deep", "docs/deep"]]. */
function crumbs(path: string): Array<[string, string]> {
  const parts = path === "." || path === "" ? [] : path.split("/");
  return [["/", "."], ...parts.map((part, index): [string, string] => [part, parts.slice(0, index + 1).join("/")])];
}

/** Read-only browser over the board's desk root. */
export function FilesView({ visible = true }: { visible?: boolean }) {
  const [path, setPath] = useState(".");
  const [listing, setListing] = useState<FileListing | null>(null);
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);

  const load = useCallback(async (target: string, keepFile = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listFiles(target);
      setListing(res);
      setPath(res.path || ".");
      if (!keepFile) setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list that folder.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(".");
  }, [load]);

  // The tab stays mounted, so coming back to it re-reads the folder (chat and
  // agents may have written files meanwhile) without closing the open file.
  const pathRef = useRef(path);
  pathRef.current = path;
  const firstShow = useRef(true);
  useEffect(() => {
    if (!visible) return;
    if (firstShow.current) {
      firstShow.current = false;
      return;
    }
    void load(pathRef.current, true);
  }, [visible, load]);

  const openFile = useCallback(async (target: string) => {
    setReading(true);
    setError(null);
    try {
      setFile(await api.readFile(target));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setReading(false);
    }
  }, []);

  const up = parentPath(path);
  const trail = crumbs(path);
  const entries = listing ? sortEntries(listing.entries) : [];

  return (
    <>
      <div className="md-files__bar">
        <nav className="md-crumb md-files__trail" aria-label="Folder path">
          {trail.map(([label, target], index) => {
            const here = index === trail.length - 1;
            return (
              <span key={target} className="md-files__step">
                {index > 1 ? <span aria-hidden="true">/</span> : null}
                {here ? (
                  <span aria-current="location">{label}</span>
                ) : (
                  <button type="button" className="md-files__crumb" onClick={() => void load(target)}>
                    {label}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
        <div className="md-files__actions">
          {up !== null ? (
            <button type="button" className="md-btn md-btn--sm" onClick={() => void load(up)}>
              Up one level
            </button>
          ) : null}
          <button type="button" className="md-btn md-btn--sm md-btn--ghost" disabled={loading} onClick={() => void load(path, true)}>
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <p className="md-error" role="alert" style={{ marginBottom: "12px" }}>
          {error}
        </p>
      ) : null}

      <div className="md-files">
        <section className="md-card md-files__panel">
          <div className="md-panel__head">
            <h2 className="md-panel__title">Workspace</h2>
            <span className="md-chip">{listing?.entries.length ?? 0}</span>
          </div>
          <div className="md-files__list">
            {loading && !listing ? (
              <div className="md-emptycard">
                <p className="md-muted">Loading this folder…</p>
              </div>
            ) : entries.length === 0 ? (
              <div className="md-emptycard">
                <p className="md-muted">This folder is empty.</p>
              </div>
            ) : (
              entries.map((entry) => {
                const target = joinPath(path, entry.name);
                const open = entry.type === "file" && file?.path === target;
                return (
                  <button
                    key={entry.name}
                    type="button"
                    className={`md-file ${entry.type === "dir" ? "md-file--dir" : ""} ${open ? "md-file--on" : ""}`}
                    aria-current={open ? "true" : undefined}
                    title={entry.name}
                    onClick={() => (entry.type === "dir" ? void load(target) : void openFile(target))}
                  >
                    <span>{entry.type === "dir" ? "▸ " : "· "}{entry.name}</span>
                    {entry.type === "file" ? <span className="md-file__size">{humanSize(entry.size)}</span> : null}
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="md-card md-files__panel md-files__viewer">
          <div className="md-panel__head">
            <h2 className="md-panel__title">{file ? "File preview" : "Preview"}</h2>
            {file ? <span className="md-chip">{file.truncated ? "Truncated" : "Full"}</span> : null}
          </div>
          {reading ? (
            <div className="md-emptycard">
              <p className="md-muted">Reading the file from the board…</p>
            </div>
          ) : file ? (
            <>
              <p className="md-crumb">
                {file.path}
                {file.truncated ? " · truncated" : ""}
              </p>
              {looksBinary(file.content) ? (
                <div className="md-emptycard">
                  <p className="md-muted" style={{ margin: 0 }}>
                    This looks like a binary file, so it is not shown as text.
                  </p>
                </div>
              ) : file.content === "" ? (
                <div className="md-emptycard">
                  <p className="md-muted" style={{ margin: 0 }}>
                    This file is empty.
                  </p>
                </div>
              ) : (
                <pre className="md-code" tabIndex={0} aria-label={`Contents of ${file.path}`}>
                  {file.content}
                </pre>
              )}
            </>
          ) : (
            <div className="md-emptycard">
              <p className="md-muted" style={{ margin: 0 }}>
                Pick a file on the left to read it. Reads are capped, so very large files arrive truncated.
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
