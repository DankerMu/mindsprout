import { Handle, Position, type NodeProps } from '@xyflow/react';
import { createContext, memo, useCallback, useContext } from 'react';
import type { ColorToken, NodeId } from '../../contexts/map/domain/types';
import type { MindFlowNode } from './flow-elements';
import styles from './MindNodeView.module.css';
import { InlineTitleInput, TitleEditingContext } from './InlineTitleInput';

// The custom React Flow node; collapse and note indicators are display only.

// The canvas's shared size observer; each rendered node registers its box through this context.
export interface NodeMeasurer {
  observe(id: NodeId, element: HTMLElement): void;
  unobserve(element: HTMLElement): void;
}

// null outside MindMapCanvas: the node then renders without being measured.
export const NodeMeasurerContext = createContext<NodeMeasurer | null>(null);

// "mind-node" and "mind-node--color-<token>" are literal contract classes (read by 9.2 and the e2e
// walk); a CSS Module class would be hashed, so the Module only adds its own scoped class.
function classNameOf(color: ColorToken | null): string {
  const names = ['mind-node', styles.node];
  if (color !== null) names.push(`mind-node--color-${color}`);
  return names.join(' ');
}

// A React 19 callback ref with cleanup: registers the box on attach, unregisters on detach.
function useMeasuredBox(id: NodeId) {
  const measurer = useContext(NodeMeasurerContext);
  return useCallback(
    (element: HTMLDivElement) => {
      if (measurer === null) return undefined;
      measurer.observe(id, element);
      return () => {
        measurer.unobserve(element);
      };
    },
    [id, measurer],
  );
}

function MindNodeBody({ id, data, selected }: NodeProps<MindFlowNode>) {
  const measuredBox = useMeasuredBox(id);
  const titleEditing = useContext(TitleEditingContext);
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className={styles.handle}
      />
      <div
        ref={measuredBox}
        className={classNameOf(data.color)}
        role="button"
        aria-pressed={selected}
        aria-label={data.text}
      >
        {titleEditing?.editing?.id === id ? (
          <InlineTitleInput text={data.text} controls={titleEditing} />
        ) : (
          <span>{data.text}</span>
        )}
        {data.hiddenCount > 0 && (
          <span
            role="img"
            aria-label={`已折叠 ${String(data.hiddenCount)} 个节点`}
            className={styles.indicator}
          >
            {data.hiddenCount}
          </span>
        )}
        {data.hasNote && (
          <span role="img" aria-label="有备注" className={styles.indicator}>
            ✎
          </span>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className={styles.handle}
      />
    </>
  );
}

export const MindNodeView = memo(MindNodeBody);
