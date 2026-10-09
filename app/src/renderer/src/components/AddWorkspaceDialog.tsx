import { useState } from "react";

import { PACKS, type PackId } from "../../../shared/contracts";
import { api, refreshAppState, updateSettings } from "../lib/bridge";
import { baseName } from "../lib/format";
import { Modal, Spinner } from "./ui";
import { Icon } from "./Icon";

export function AddWorkspaceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [pack, setPack] = useState<PackId>("general");
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function chooseFolder() {
    const picked = await api.call("workspace:pick-folder", undefined).catch(() => null);
    if (!picked) return;
    setFolder(picked);
    if (!name.trim()) setName(baseName(picked));
  }

  async function create() {
    setBusy(true);
    try {
      const ws = await api.call("workspace:create", { name: name.trim() || (folder ? baseName(folder) : "New project"), folder, pack });
      await updateSettings({ activeWorkspaceId: ws.id });
      await refreshAppState();
      onCreated(ws.id);
    } catch {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add a project" onClose={onClose}>
      <p className="muted">A project is one folder on this computer that NONON can work in. It will not touch anything outside that folder.</p>
      <label className="field">
        <span>Project name</span>
        <input className="input" value={name} maxLength={40} placeholder="For example: Shop books" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>What kind of work will you do here?</span>
        <select className="input" value={pack} onChange={(e) => setPack(e.target.value as PackId)}>
          {PACKS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span className="field-label">Folder</span>
        <div className="folder-row">
          <button type="button" className="btn" onClick={() => void chooseFolder()}>
            <Icon name="folder" size={18} tone="accent" /> {folder ? "Choose a different folder" : "Choose a folder"}
          </button>
          {folder && (
            <span className="folder-path" title={folder}>
              {folder}
            </span>
          )}
        </div>
        {folder && (
          <span className="muted small">
            NONON saves what it makes in a folder called <strong>NONON Output</strong> inside this folder.
          </span>
        )}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy || !folder}>
          {busy && <Spinner />}
          Add project
        </button>
      </div>
    </Modal>
  );
}
