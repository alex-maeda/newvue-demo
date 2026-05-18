import { useCallback, useRef } from 'react';
import useReportStore from '../../stores/useReportStore';
import ContentBox from './ContentBox';
import DropdownBox from './DropdownBox';
import LineActions from './LineActions';

export default function ReportNode({ node, depth = 0, parentOffset = 0 }) {
  const boxState = useReportStore((s) => s.contentBoxStates[node.id]);
  const nodeText = useReportStore((s) => s.nodeTextStates[node.id]);
  const updateNodeText = useReportStore((s) => s.updateNodeText);

  // Calculate the physical left padding + 1px border of this node type
  // This must match the index.css overrides to maintain perfect vertical lock!
  let paddingLeft = 6; // default baseline padding-left in .report-node
  if (node.type === 'section') paddingLeft = 12;
  else if (node.type === 'subsection') paddingLeft = 20;
  else if (node.type === 'subsubsection') paddingLeft = 28;
  else if (node.type === 'detail') paddingLeft = 36;
  else if (node.type === 'deep') paddingLeft = 42;

  const nodeOffsetShift = paddingLeft + 1; // +1 for the 1px transparent border pushing content
  const currentTotalOffset = parentOffset + nodeOffsetShift;

  const isDeleted = boxState?.deleted;
  const isContent = node.type === 'content';
  const isDropdown = isContent && (node.inputType === 'select' || boxState?.inputType === 'select');

  const inputRef = useRef(null);

  const handleLabelChange = useCallback((e) => {
    updateNodeText(node.id, e.target.value);
  }, [node.id, updateNodeText]);

  const handleLabelKeyDown = useCallback((e) => {
    // Blur on Enter (accept the edit)
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    }
    // Escape reverts to original text
    if (e.key === 'Escape') {
      e.preventDefault();
      if (nodeText) {
        updateNodeText(node.id, nodeText.originalText);
      }
      e.target.blur();
    }
  }, [node.id, nodeText, updateNodeText]);

  const nodeClass = [
    'report-node',
    `report-node--${node.type}`,
    isDeleted ? 'report-node--deleted' : '',
  ].filter(Boolean).join(' ');

  const displayText = nodeText?.text ?? node.label ?? node.text ?? '';

  return (
    <div className={nodeClass} id={`node-${node.id}`} data-node-id={node.id}>
      {/* Node body */}
      <div className="report-node__body">
        {isContent ? (
          /* Content nodes render an editable textarea */
          isDropdown ? (
            <DropdownBox node={node} />
          ) : (
            <ContentBox node={node} />
          )
        ) : (
          /* Non-content nodes render an editable label input */
          <input
            ref={inputRef}
            type="text"
            className={[
              'report-node__label-input',
              nodeText?.edited ? 'report-node__label-input--edited' : '',
            ].filter(Boolean).join(' ')}
            value={displayText}
            onChange={handleLabelChange}
            onKeyDown={handleLabelKeyDown}
            spellCheck={false}
            aria-label={`Edit ${node.type} label`}
            id={`label-${node.id}`}
          />
        )}

        {/* Children — recursive rendering */}
        {node.children?.map((child) => (
          <ReportNode key={child.id} node={child} depth={depth + 1} parentOffset={currentTotalOffset} />
        ))}
      </div>

      {/* Line action buttons (only for content nodes) */}
      {isContent && <LineActions node={node} parentOffset={parentOffset} />}
    </div>
  );
}
