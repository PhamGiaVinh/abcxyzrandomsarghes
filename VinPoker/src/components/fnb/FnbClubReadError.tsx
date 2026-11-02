import { Button } from "@/components/ui/button";

export function FnbClubReadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="container mx-auto max-w-5xl space-y-3 px-4 py-6">
    <p className="text-sm text-destructive">{message}</p>
    <Button variant="outline" onClick={onRetry}>Thử tải lại CLB</Button>
  </div>;
}
