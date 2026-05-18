import useReportStore from '../../stores/useReportStore';

export default function AsrVendorDropdown() {
  const vendor = useReportStore((s) => s.asrVendor);
  const setVendor = useReportStore((s) => s.setAsrVendor);
  const asrStatus = useReportStore((s) => s.asrStatus);

  const isActive = ['listening', 'connecting', 'reconnecting'].includes(asrStatus);

  return (
    <select
      className="asr-vendor-dropdown"
      id="asr-vendor-select"
      value={vendor}
      onChange={(e) => setVendor(e.target.value)}
      disabled={isActive}
      title={isActive ? 'Stop dictation to switch ASR vendor' : 'Select ASR vendor'}
    >
      <option value="speechmatics">Speechmatics</option>
      <option value="deepgram">Deepgram Nova 3</option>
    </select>
  );
}
