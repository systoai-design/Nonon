import { useMemo, useState } from "react";
import { Power } from "lucide-react";
import type { Routine } from "../../../shared/contracts";
import { call, errMsg, useCall, useEvent } from "./lib";
import { ErrorLine, Loading, Notice, PageHeader, Switch } from "./ui";
import { NewRoutine } from "./routines/NewRoutine";
import { RoutineCard } from "./routines/RoutineCard";
import { Icon } from "../components/Icon";
import { useFirstShow } from "../lib/motion";

export interface RoutinesViewProps {
  workspaceId: string;
}

function BackgroundOptIn() {
  const state = useCall("app:state", undefined);
  const [error, setError] = useState<string | null>(null);
  useEvent("settings:updated", (s) => state.setData((prev) => (prev ? { ...prev, settings: s } : prev)));
  const on = state.data?.settings.backgroundRoutines ?? false;

  const change = async (next: boolean) => {
    setError(null);
    try {
      const s = await call("settings:update", { backgroundRoutines: next });
      state.setData((prev) => (prev ? { ...prev, settings: s } : prev));
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <div className="panel flex items-start justify-between gap-4 p-4">
      <div className="flex gap-3">
        <Power size={20} className="mt-0.5 shrink-0 muted" aria-hidden />
        <div>
          <div className="font-medium" id="bg-routines-label">
            Keep routines running when I close NONON
          </div>
          <p className="m-0 mt-0.5 text-[14px] muted">
            Off by default. When it is on, NONON keeps running quietly after you close its window, so routines can still run. Either way,
            your computer must be turned on and awake.
          </p>
          {error && <ErrorLine>{error}</ErrorLine>}
        </div>
      </div>
      <Switch checked={on} onChange={change} label="Keep routines running when I close NONON" disabled={!state.data} />
    </div>
  );
}

export function RoutinesView({ workspaceId }: RoutinesViewProps) {
  const routines = useCall("routine:list", { workspaceId });
  const procedures = useCall("procedure:list", {});
  const [creating, setCreating] = useState(false);
  const firstShow = useFirstShow("routines-list");

  useEvent("routine:updated", (r) => {
    if (r.workspaceId !== workspaceId) return;
    routines.setData((prev) => {
      const list = prev ?? [];
      return list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [...list, r];
    });
  });

  const titles = useMemo(() => new Map((procedures.data ?? []).map((p) => [p.id, p.title])), [procedures.data]);
  const upsert = (r: Routine) =>
    routines.setData((prev) => {
      const list = prev ?? [];
      return list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [...list, r];
    });

  return (
    <section className="scroll-y h-full">
      <div className="col flex flex-col gap-6 pt-4 pb-8">
        <PageHeader
          subtitle="Jobs NONON does for you on a schedule. You check the results before anything in your files changes."
          right={
            !creating && (
              <button type="button" className="btn btn-primary shrink-0" onClick={() => setCreating(true)}>
                <Icon name="plus" size={18} tone="current" /> New routine
              </button>
            )
          }
        />

        <Notice tone="warn">Your computer must be turned on and awake for routines to run.</Notice>
        <BackgroundOptIn />

        {creating && (
          <NewRoutine
            workspaceId={workspaceId}
            procedureTitleFor={(id) => titles.get(id)}
            onSaved={(r) => {
              upsert(r);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        )}

        {routines.loading && <Loading />}
        {routines.error && <ErrorLine>{routines.error}</ErrorLine>}

        {!routines.loading && !routines.error && (routines.data ?? []).length === 0 && !creating && (
          <div className="panel p-6 text-center">
            <p className="m-0 font-medium">No routines yet.</p>
            <p className="m-0 mt-1 text-[14px] muted">
              A routine repeats a job for you, like comparing the newest spreadsheet every weekday morning. Press New routine and describe it in your own
              words.
            </p>
          </div>
        )}

        {(routines.data ?? []).length > 0 && (
          <div className="flex flex-col gap-6" data-stagger={firstShow || undefined}>
            {(routines.data ?? []).map((r, i) => (
              <div key={r.id} style={{ "--i": i } as React.CSSProperties}>
                <RoutineCard
                  routine={r}
                  procedureTitle={titles.get(r.procedureId)}
                  onChanged={upsert}
                  onRemoved={(id) => routines.setData((prev) => (prev ?? []).filter((x) => x.id !== id))}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
