import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { failOnConsoleNoise, nodeWrapper } from '../../../tests/support/canvas';
import { mapOf, node } from '../../../tests/support/map-domain';
import { RecordingRepository } from '../../../tests/support/map-repository-stub';
import { nodeMenu } from '../../contexts/map/application/menu/menu';
import { EditorSession } from '../editor/EditorSession';
import { EditorView } from '../editor/EditorView';

failOnConsoleNoise();
nodeMenu.register({
  id: 'grow-test',
  label: '生长分支',
  isEnabled: () => true,
  run: (ctx) => {
    ctx.actions.dispatch({
      op: 'add_children',
      parentId: ctx.target,
      children: [{ id: 'grown', text: '长出的分支' }],
    });
  },
});

it('renders and runs an added registration without component-specific execution', () => {
  render(
    <EditorSession map={mapOf(node('r'))} repository={new RecordingRepository()}>
      <EditorView />
    </EditorSession>,
  );
  fireEvent.contextMenu(nodeWrapper('r'));
  expect(screen.getAllByRole('menuitem')).toHaveLength(7);
  fireEvent.click(screen.getByRole('menuitem', { name: '生长分支' }));
  expect(nodeWrapper('grown').textContent).toBe('长出的分支');
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  expect(document.querySelector('[data-id="grown"]')).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '撤销' }).disabled).toBe(true);
});
