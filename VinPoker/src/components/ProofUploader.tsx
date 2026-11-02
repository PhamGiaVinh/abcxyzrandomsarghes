import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { ProofUploadWorkspace, type ProofUploaderProps } from "./ProofUploadWorkspace";

export { ProofUploadWorkspace } from "./ProofUploadWorkspace";

export const ProofUploader = (props: ProofUploaderProps) => {
  const { user, session } = useAuth();
  return <ProofUploadWorkspace {...props} actorId={user?.id} sessionEpoch={sessionReadEpoch(session)} />;
};
