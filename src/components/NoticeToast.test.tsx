import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { NoticeToast } from './NoticeToast';

it('renders the current notice and dismisses explicitly without a timer', () => {
  const dismiss = vi.fn();
  const timer = vi.spyOn(globalThis, 'setTimeout');
  const view = render(<NoticeToast notice={null} onDismiss={dismiss} />);
  expect(screen.queryByRole('alert')).toBeNull();
  view.rerender(<NoticeToast notice="保存失败" onDismiss={dismiss} />);
  expect(screen.getByRole('alert').textContent).toContain('保存失败');
  view.rerender(<NoticeToast notice="主根不能删除" onDismiss={dismiss} />);
  expect(screen.getByRole('alert').textContent).toContain('主根不能删除');
  expect(screen.queryByText('保存失败')).toBeNull();
  expect(timer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
  expect(dismiss).toHaveBeenCalledOnce();
});
