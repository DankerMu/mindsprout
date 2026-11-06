import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import type { EditorState } from '../../contexts/map/application/editor-store/editor-store';
import { failOnConsoleNoise, nodeWrapper } from '../../../tests/support/canvas';
import { mapOf, node } from '../../../tests/support/map-domain';
import { RecordingRepository } from '../../../tests/support/map-repository-stub';
import { StorageUnavailableError } from '../../contexts/map/domain/errors';
import { EditorSession, useEditorStoreApi } from './EditorSession';
import { EditorView } from './EditorView';

// Design "Fixture — issue #16": the editor's header, canvas area and ready marker, rendered inside
// a real EditorSession; the canvas is the unmocked MindMapCanvas.

failOnConsoleNoise();
afterEach(() => {
  vi.useRealTimers();
});

// The title and the primary root text differ, so the header cannot pass by showing the root.
const MAP = { ...mapOf(node('r', [node('a')], { text: '根节点B' })), title: '标题A' };

describe('EditorView', () => {
  it('shows the map title in the header, the ready marker and the canvas', () => {
    render(
      <EditorSession map={MAP} repository={new RecordingRepository()}>
        <EditorView />
      </EditorSession>,
    );

    expect(screen.getByTestId('editor-title').textContent).toBe('标题A');
    expect(screen.getByTestId('map-editor-ready').contains(nodeWrapper('r'))).toBe(true);
    expect(nodeWrapper('r').textContent).toBe('根节点B');
  });

  it('projects click and Shift toggle selection and routes canvas keys to the session', () => {
    render(
      <EditorSession map={MAP} repository={new RecordingRepository()}>
        <EditorView />
      </EditorSession>,
    );
    fireEvent.click(nodeWrapper('r'));
    expect(nodeWrapper('r').querySelector('[aria-pressed="true"]')).not.toBeNull();
    fireEvent.click(nodeWrapper('a'), { shiftKey: true });
    expect(nodeWrapper('r').querySelector('[aria-pressed="true"]')).not.toBeNull();
    expect(nodeWrapper('a').querySelector('[aria-pressed="true"]')).not.toBeNull();
    fireEvent.click(nodeWrapper('a'), { shiftKey: true });
    expect(nodeWrapper('a').querySelector('[aria-pressed="true"]')).toBeNull();
    fireEvent.keyDown(nodeWrapper('r'), { key: 'ArrowRight' });
    expect(nodeWrapper('a').querySelector('[aria-pressed="true"]')).not.toBeNull();
    expect(nodeWrapper('r').querySelector('[aria-pressed="true"]')).toBeNull();
  });

  it.each([false, true])(
    'shows one persistent banner after an unavailable put (provider=%s)',
    async (providerUnavailable) => {
      const repository = new RecordingRepository();
      repository.rejectNext(new StorageUnavailableError('connection unavailable'));
      let store: StoreApi<EditorState> | undefined;
      function Probe() {
        store = useEditorStoreApi();
        return null;
      }
      render(
        <EditorSession map={MAP} repository={repository}>
          <Probe />
          <EditorView storageUnavailable={providerUnavailable} />
        </EditorSession>,
      );
      fireEvent.doubleClick(nodeWrapper('a'));
      fireEvent.change(screen.getByLabelText('节点标题'), { target: { value: '会话中的改名' } });
      fireEvent.keyDown(screen.getByLabelText('节点标题'), { key: 'Enter' });
      await act(async () => {
        await store?.getState().flush();
      });
      expect(screen.getAllByText('未保存到浏览器')).toHaveLength(1);
      expect(screen.queryByText('保存失败')).toBeNull();
      expect(nodeWrapper('a').textContent).toBe('会话中的改名');
      expect(repository.puts).toHaveLength(1);
      act(() => {
        store?.getState().startEdit('a');
        store?.getState().commitTitle('仍用原仓库');
      });
      await act(async () => {
        await store?.getState().flush();
      });
      expect(repository.puts).toHaveLength(2);
      expect(repository.puts[1]?.roots[0]?.children[0]?.text).toBe('仍用原仓库');
      expect(screen.getAllByText('未保存到浏览器')).toHaveLength(1);
    },
  );

  it('keeps a failed rename, renders the current store notice and clears it only on dismiss', async () => {
    vi.useFakeTimers();
    const repository = new RecordingRepository();
    repository.rejectNext(new DOMException('quota', 'QuotaExceededError'));
    let store: StoreApi<EditorState> | undefined;
    function Probe() {
      store = useEditorStoreApi();
      return null;
    }
    render(
      <EditorSession map={MAP} repository={repository}>
        <Probe />
        <EditorView />
      </EditorSession>,
    );
    fireEvent.doubleClick(nodeWrapper('a'));
    fireEvent.change(screen.getByLabelText('节点标题'), { target: { value: '未丢失的文字' } });
    fireEvent.keyDown(screen.getByLabelText('节点标题'), { key: 'Enter' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByRole('alert').textContent).toContain('保存失败');
    expect(nodeWrapper('a').textContent).toBe('未丢失的文字');
    expect(screen.queryByText('未保存到浏览器')).toBeNull();
    act(() => {
      store?.getState().showNotice('主根不能删除');
    });
    expect(screen.getByRole('alert').textContent).toContain('主根不能删除');
    expect(screen.queryByText('保存失败')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(store?.getState().notice).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(nodeWrapper('a').textContent).toBe('未丢失的文字');
  });
});
