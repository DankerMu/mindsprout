import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { failOnConsoleNoise, nodeWrapper } from '../../../tests/support/canvas';
import { mapOf, node } from '../../../tests/support/map-domain';
import { RecordingRepository } from '../../../tests/support/map-repository-stub';
import { EditorSession } from './EditorSession';
import { EditorView } from './EditorView';

// Design "Fixture — issue #16": the editor's header, canvas area and ready marker, rendered inside
// a real EditorSession; the canvas is the unmocked MindMapCanvas.

failOnConsoleNoise();

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
});
