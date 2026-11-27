import { expect, expectTypeOf, it } from 'vitest';
import {
  parseTreeOp as domainParseTreeOp,
  type TreeOp as DomainTreeOp,
} from '../../map/domain/tree-op';
import type { NewNode as DomainNewNode, NodeId as DomainNodeId } from '../../map/domain/types';
import { type NewNode, type NodeId, parseTreeOp, type TreeOp } from './map';

it('exposes the original TreeOp schema boundary and node types through the ai ACL', () => {
  expect(parseTreeOp).toBe(domainParseTreeOp);
  expectTypeOf<TreeOp>().toEqualTypeOf<DomainTreeOp>();
  expectTypeOf<NewNode>().toEqualTypeOf<DomainNewNode>();
  expectTypeOf<NodeId>().toEqualTypeOf<DomainNodeId>();
});
