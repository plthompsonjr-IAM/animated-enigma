import { changeContractStatus } from '@/lib/contracts/actions';
import {
  allowedTransitions,
  CONTRACT_STATUS_LABELS,
  type ContractStatus,
} from '@/lib/contracts/contracts-core';
import { Button } from '@/components/ui/button';

const INTENT: Record<ContractStatus, string> = {
  draft: 'Return to draft',
  active: 'Activate contract',
  completed: 'Mark completed',
  cancelled: 'Cancel contract',
};

/**
 * Lifecycle controls. Activating is the point of no return — it freezes the
 * value and terms — so it is called out explicitly rather than hidden in a menu.
 */
export function StatusActions({
  contractId,
  status,
}: {
  contractId: string;
  status: ContractStatus;
}) {
  const options = allowedTransitions(status);
  if (options.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This contract is {CONTRACT_STATUS_LABELS[status].toLowerCase()} and has no further steps.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {status === 'draft' ? (
        <p className="text-sm text-muted-foreground">
          Activating locks the contract value and payment terms. After that, changes require a
          change order.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {options.map((next) => (
          <form key={next} action={changeContractStatus}>
            <input type="hidden" name="contractId" value={contractId} />
            <input type="hidden" name="status" value={next} />
            <Button
              type="submit"
              size="sm"
              variant={next === 'cancelled' ? 'outline' : 'default'}
              className="w-auto"
            >
              {INTENT[next]}
            </Button>
          </form>
        ))}
      </div>
    </div>
  );
}
