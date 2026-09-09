import { BelanjaSyncBatchPanel } from "@/features/belanja-sync/belanja-sync-batch-panel";
import { BelanjaSyncView } from "@/features/belanja-sync/belanja-sync-view";

export default function BelanjaSyncPage() {
  return (
    <div className="space-y-6">
      <BelanjaSyncBatchPanel />
      <BelanjaSyncView />
    </div>
  );
}
