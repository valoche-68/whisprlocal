import type { Workspace } from "../../types/electron";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: Workspace[];
  initialWorkspaceId?: string;
  initialBillingInterval?: "monthly" | "annual";
  onRefreshEntitlement?: () => Promise<void> | void;
}

export default function EnterpriseCheckoutDialog(_props: Props): null {
  return null;
}
