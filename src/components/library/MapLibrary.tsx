import { nanoid } from 'nanoid';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { deleteMap } from '../../contexts/map/application/delete-map';
import { renameMap } from '../../contexts/map/application/rename-map';
import { UnsupportedSchemaVersionError } from '../../contexts/map/domain/errors';
import { createMindMap } from '../../contexts/map/domain/create-mind-map';
import type { MapRepository, MapSummary } from '../../contexts/map/domain/map-repository';
import { byRecency } from '../../contexts/map/domain/summary-order';

interface LibraryLifetime {
  cancelled: boolean;
  pending: boolean;
}

function isCancelled(lifetime: LibraryLifetime): boolean {
  return lifetime.cancelled;
}

type LibraryState = { repository: MapRepository } & (
  { status: 'error' } | { status: 'ready'; maps: MapSummary[]; lifetime: LibraryLifetime }
);

interface MutationSession {
  lifetime: LibraryLifetime;
  id: string;
  title: string;
  trigger: HTMLButtonElement;
  pending: boolean;
  error: string | null;
}

function ownsSession(
  lifetime: LibraryLifetime | null,
  session: MutationSession,
): lifetime is LibraryLifetime {
  return lifetime !== null && session.lifetime === lifetime;
}

function activeSession(loaded: LibraryState | null, session: MutationSession | null) {
  if (loaded?.status !== 'ready') return null;
  return session?.lifetime === loaded.lifetime ? session : null;
}

function RenameForm({
  session,
  onCancel,
  onSave,
}: {
  session: MutationSession;
  onCancel: () => void;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState(session.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <form
      aria-label={`重命名 ${session.title}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(title);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onCancel();
      }}
    >
      <label>
        标题
        <input
          ref={input}
          value={title}
          disabled={session.pending}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </label>
      <button type="submit" disabled={session.pending}>
        保存
      </button>
      <button type="button" disabled={session.pending} onClick={onCancel}>
        取消
      </button>
      {session.pending && <p role="status">正在保存…</p>}
      {session.error !== null && <p role="alert">{session.error}</p>}
    </form>
  );
}

function DeleteConfirmation({
  session,
  onCancel,
  onConfirm,
}: {
  session: MutationSession;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  return (
    <dialog
      open
      aria-label={`删除 ${session.title}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onCancel();
      }}
    >
      <p>确定永久删除“{session.title}”吗？</p>
      <button ref={cancel} type="button" disabled={session.pending} onClick={onCancel}>
        取消
      </button>
      <button type="button" disabled={session.pending} onClick={onConfirm}>
        确认删除
      </button>
      {session.pending && <p role="status">正在删除…</p>}
      {session.error !== null && <p role="alert">{session.error}</p>}
    </dialog>
  );
}

type StartMutation = (
  action: 'rename' | 'delete',
  summary: MapSummary,
  trigger: HTMLButtonElement,
) => void;

function LibraryRows({
  maps,
  pending,
  onAction,
}: {
  maps: MapSummary[];
  pending: boolean;
  onAction: StartMutation;
}) {
  return (
    <ul>
      {maps.map((summary) => {
        const { id, title, updatedAt } = summary;
        return (
          <li key={id}>
            <Link href={`/maps/${encodeURIComponent(id)}`}>{title}</Link>
            {' — '}
            <time dateTime={updatedAt}>{updatedAt}</time>
            <button
              type="button"
              aria-label={`重命名 ${title}`}
              disabled={pending}
              onClick={(event) => {
                onAction('rename', summary, event.currentTarget);
              }}
            >
              重命名
            </button>
            <button
              type="button"
              aria-label={`删除 ${title}`}
              disabled={pending}
              onClick={(event) => {
                onAction('delete', summary, event.currentTarget);
              }}
            >
              删除
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function MapLibrary({
  repository,
  navigate,
}: {
  repository: MapRepository;
  navigate: (href: string) => void;
}) {
  const [loaded, setLoaded] = useState<LibraryState | null>(null);
  const activeLifetime = useRef<LibraryLifetime | null>(null);
  const [creation, setCreation] = useState<{
    lifetime: LibraryLifetime;
    status: 'pending' | 'failed';
  } | null>(null);
  const [renaming, setRenaming] = useState<MutationSession | null>(null);
  const [deleting, setDeleting] = useState<MutationSession | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const renameSession = activeSession(loaded, renaming);
  const deleteSession = activeSession(loaded, deleting);
  useEffect(() => {
    if (renameSession !== null || deleteSession !== null) return;
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
    else if (returnFocus.current !== null) createButton.current?.focus();
    returnFocus.current = null;
  }, [renameSession, deleteSession]);
  useEffect(() => {
    const lifetime: LibraryLifetime = { cancelled: false, pending: false };
    activeLifetime.current = lifetime;
    void repository.list().then(
      (maps) => {
        if (!lifetime.cancelled) setLoaded({ status: 'ready', maps, repository, lifetime });
      },
      () => {
        if (!lifetime.cancelled) setLoaded({ status: 'error', repository });
      },
    );
    return () => {
      lifetime.cancelled = true;
    };
  }, [repository]);
  async function create() {
    const lifetime = activeLifetime.current;
    if (lifetime === null || isCancelled(lifetime) || lifetime.pending) return;
    lifetime.pending = true;
    setCreation({ lifetime, status: 'pending' });
    setRenaming(null);
    setDeleting(null);
    const map = createMindMap({
      id: nanoid(),
      rootId: nanoid(),
      title: '新导图',
      rootText: '新导图',
    });
    try {
      await repository.put(map);
    } catch {
      if (isCancelled(lifetime)) return;
      lifetime.pending = false;
      setCreation({ lifetime, status: 'failed' });
      return;
    }
    if (!isCancelled(lifetime)) navigate(`/maps/${encodeURIComponent(map.id)}`);
  }
  function closeRename(session: MutationSession) {
    returnFocus.current = session.trigger;
    setRenaming(null);
  }
  async function saveRename(title: string) {
    const session = renameSession;
    const lifetime = activeLifetime.current;
    if (
      session === null ||
      !ownsSession(lifetime, session) ||
      lifetime.pending ||
      isCancelled(lifetime)
    )
      return;
    const { id } = session;
    lifetime.pending = true;
    setRenaming({ ...session, pending: true, error: null });
    try {
      const saved = await renameMap(repository, id, title, {
        isActive: () => !isCancelled(lifetime),
      });
      if (isCancelled(lifetime) || saved === undefined) return;
      lifetime.pending = false;
      setLoaded((current) => {
        if (current?.status !== 'ready' || current.lifetime !== lifetime) return current;
        const maps = current.maps.map((summary) =>
          summary.id === id ? { id, title: saved.title, updatedAt: saved.updatedAt } : summary,
        );
        return { ...current, maps: maps.sort(byRecency) };
      });
      closeRename(session);
    } catch (error) {
      if (isCancelled(lifetime)) return;
      lifetime.pending = false;
      setRenaming({
        ...session,
        pending: false,
        error:
          error instanceof UnsupportedSchemaVersionError
            ? '此导图由更新版本创建'
            : '保存失败，请重试',
      });
    }
  }
  function closeDelete(session: MutationSession) {
    returnFocus.current = session.trigger;
    setDeleting(null);
  }
  async function confirmDelete() {
    const session = deleteSession;
    const lifetime = activeLifetime.current;
    if (
      session === null ||
      !ownsSession(lifetime, session) ||
      lifetime.pending ||
      isCancelled(lifetime)
    )
      return;
    const { id } = session;
    lifetime.pending = true;
    setDeleting({ ...session, pending: true, error: null });
    try {
      await deleteMap(repository, id);
      if (isCancelled(lifetime)) return;
      lifetime.pending = false;
      setLoaded((current) => {
        if (current?.status !== 'ready' || current.lifetime !== lifetime) return current;
        return { ...current, maps: current.maps.filter((summary) => summary.id !== id) };
      });
      closeDelete(session);
    } catch {
      if (isCancelled(lifetime)) return;
      lifetime.pending = false;
      setDeleting({ ...session, pending: false, error: '保存失败，请重试' });
    }
  }
  if (loaded?.repository !== repository) return <p role="status">正在加载导图…</p>;
  if (loaded.status === 'error') return <p role="alert">无法读取导图列表</p>;
  const creationStatus = creation?.lifetime === loaded.lifetime ? creation.status : 'idle';
  const pending = loaded.lifetime.pending;
  const openAction: StartMutation = (action, { id, title }, trigger) => {
    const { lifetime } = loaded;
    if (lifetime.pending) return;
    const session = { lifetime, id, title, trigger, pending: false, error: null };
    setCreation(null);
    setRenaming(action === 'rename' ? session : null);
    setDeleting(action === 'delete' ? session : null);
  };
  return (
    <section aria-label="导图列表">
      <button
        ref={createButton}
        type="button"
        disabled={pending}
        onClick={() => {
          void create();
        }}
      >
        新建导图
      </button>
      {creationStatus === 'failed' && <p role="alert">保存失败，请重试</p>}
      {loaded.maps.length === 0 && <p>还没有导图</p>}
      {renameSession !== null && (
        <RenameForm
          key={renameSession.id}
          session={renameSession}
          onCancel={() => {
            if (!renameSession.lifetime.pending) closeRename(renameSession);
          }}
          onSave={(title) => {
            void saveRename(title);
          }}
        />
      )}
      {deleteSession !== null && (
        <DeleteConfirmation
          key={deleteSession.id}
          session={deleteSession}
          onCancel={() => {
            if (!deleteSession.lifetime.pending) closeDelete(deleteSession);
          }}
          onConfirm={() => {
            void confirmDelete();
          }}
        />
      )}
      <LibraryRows maps={loaded.maps} pending={pending} onAction={openAction} />
    </section>
  );
}
