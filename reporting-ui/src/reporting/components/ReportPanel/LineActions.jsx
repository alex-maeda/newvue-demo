import useReportStore from '../../stores/useReportStore';

export default function LineActions({ node, parentOffset = 0 }) {
  const boxState = useReportStore((s) => s.contentBoxStates[node.id]);
  const toggleSoftDelete = useReportStore((s) => s.toggleSoftDelete);
  const addContentNode = useReportStore((s) => s.addContentNode);
  const removeNode = useReportStore((s) => s.removeNode);

  const isDeleted = boxState?.deleted;
  const isUserAdded = node.id?.startsWith('content_user_');
  const isPass2Inserted = boxState?.pass2Inserted || node.id?.startsWith('content_pass2_');
  const isRemovable = isUserAdded || isPass2Inserted;

  // For non-content nodes, don't show actions
  if (node.type !== 'content') return null;

  // We want the group to ALWAYS be exactly 4px from the UI's far left edge.
  // The global report panel has 47px padding-left. 
  // Target position relative to panel content box = -43px
  // Since we are nested at `parentOffset`, our left coordinate must compensate:
  const leftPosition = -43 - parentOffset;

  if (isDeleted) {
    return (
      <div className="line-actions" style={{ left: `${leftPosition}px` }}>
        <button
          className="line-action-btn line-action-btn--restore"
          onClick={() => toggleSoftDelete(node.id)}
          title="Restore"
          aria-label="Restore line"
          id={`restore-btn-${node.id}`}
          style={{ marginLeft: '25px' }} /* Push to middle position overlaying trashcan */
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="line-actions" style={{ left: `${leftPosition}px` }}>
      {/* Move handle (visual placeholder) */}
      <button
        className="line-action-btn"
        title="Drag to reorder"
        aria-label="Drag to reorder"
        style={{ cursor: 'grab' }}
        id={`drag-btn-${node.id}`}
      >
        <svg viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>

      {/* Delete / Remove */}
      <button
        className={`line-action-btn line-action-btn--delete`}
        onClick={() => {
          if (isRemovable) {
            removeNode(node.id);
          } else {
            toggleSoftDelete(node.id);
          }
        }}
        title={isRemovable ? 'Remove line' : 'Delete line'}
        aria-label={isRemovable ? 'Remove line' : 'Delete line'}
        id={`delete-btn-${node.id}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>

      {/* Add */}
      <button
        className="line-action-btn"
        onClick={() => addContentNode(null, node.id)}
        title="Add line below"
        aria-label="Add line below"
        id={`add-btn-${node.id}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
