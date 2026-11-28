import { Handle, Position, type NodeProps } from '@xyflow/react';
import { createContext, memo, useCallback, useContext, useState, type AnimationEvent } from 'react';
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
function classNameOf(color: ColorToken | null, entering: boolean): string {
  const names = ['mind-node', styles.node];
  if (entering) names.push(styles.enter);
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

function MindNodeBody({ id, data, selected, width, height }: NodeProps<MindFlowNode>) {
  const measuredBox = useMeasuredBox(id);
  const titleEditing = useContext(TitleEditingContext);
  // Kept from mount until the fade ends: React reinserts wrappers when a move reorders them, and a
  // reinserted element would replay the animation. The instance survives the DOM move.
  const [entering, setEntering] = useState(true);
  const entered = (event: AnimationEvent) => {
    if (event.target === event.currentTarget) setEntering(false);
  };
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
        className={classNameOf(data.color, entering)}
        onAnimationEnd={entered}
        role="button"
        aria-pressed={selected}
        aria-label={data.text}
      >
        {titleEditing?.editing?.id === id ? (
          <InlineTitleInput
            text={data.text}
            controls={titleEditing}
            measured={Boolean(width && height)}
          />
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
