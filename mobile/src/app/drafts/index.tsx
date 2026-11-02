import { useMemo } from "react";
import { useSession } from "../../auth/context";
import { DraftAccessGate } from "../../drafts/DraftAccessGate";
import { DraftsListScreen } from "../../drafts/DraftsListScreen";
import { nativeDraftTools } from "../../drafts/native";
export default function Drafts() {
  const { session, generation } = useSession();
  const tools = useMemo(() => nativeDraftTools(session), [session]);
  return <DraftAccessGate><DraftsListScreen key={generation} tools={tools} /></DraftAccessGate>;
}
