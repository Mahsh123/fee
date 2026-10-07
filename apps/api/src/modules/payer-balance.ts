import { Money } from '@fee/money';

export type PayerBalanceShare = {
  id: string | null;
  priority: number;
  actualOutstanding: Money;
  reserved: Money;
};

/**
 * Cap shares that are not already reserved against the fee item's live balance.
 * Existing reservations remain held and reduce the capacity available to all
 * other payers. The synthetic student share is the live balance left after the
 * configured snapshots' actual outstanding amounts are accounted for.
 */
type SyntheticPayerShare<T extends PayerBalanceShare> = Omit<T, 'id'> & { id: null };

export function capPayerShareBalances<T extends PayerBalanceShare>(input: {
  itemBalance: Money;
  activeReservations: Money;
  shares: readonly T[];
  studentResidual: (actualOutstanding: Money) => SyntheticPayerShare<T>;
}): Array<(T | SyntheticPayerShare<T>) & { outstanding: Money }> {
  const currency = input.itemBalance.currency.code;
  const configuredOutstanding = input.shares.reduce(
    (sum, share) => sum.add(share.actualOutstanding.isPositive ? share.actualOutstanding : Money.zero(currency)),
    Money.zero(currency),
  );
  const residualAmount = input.itemBalance.subtract(configuredOutstanding);
  const shares: Array<T | SyntheticPayerShare<T>> = [...input.shares];
  if (residualAmount.isPositive) shares.push(input.studentResidual(residualAmount));

  const reservations = input.activeReservations.isPositive ? input.activeReservations : Money.zero(currency);
  const initialCapacity = input.itemBalance.subtract(reservations);
  let capacity = initialCapacity.isPositive ? initialCapacity : Money.zero(currency);

  // A null id denotes the synthetic residual and sorts after persisted IDs on
  // a priority tie, giving it a stable position without inventing a DB id.
  const ordered = [...shares].sort((left, right) => {
    const priorityOrder = left.priority - right.priority;
    if (priorityOrder) return priorityOrder;
    const leftId = left.id ?? '\uffff';
    const rightId = right.id ?? '\uffff';
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });

  return ordered.map((share) => {
    const unreserved = share.actualOutstanding.subtract(share.reserved);
    const eligible = unreserved.isPositive ? unreserved : Money.zero(currency);
    const outstanding = eligible.min(capacity);
    capacity = capacity.subtract(outstanding);
    return { ...share, outstanding };
  });
}
