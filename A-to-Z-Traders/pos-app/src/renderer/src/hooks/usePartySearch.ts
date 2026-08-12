import { useMemo } from 'react'
import type { Customer, PartyType } from '@shared/types'
import type { ComboOption } from '../components/ui/Combobox'
import { useDebounced } from './useDebounced'
import { useQuery } from './useQuery'
import { api, unwrap } from '../lib/api'
import * as format from '../lib/format'

/**
 * Customer or supplier lookup, showing the outstanding balance next to each
 * name — the one fact worth knowing before starting a credit bill.
 */
export function usePartySearch(
  partyType: PartyType,
  query: string,
  limit = 10
): { options: ComboOption<Customer>[]; isLoading: boolean } {
  const debounced = useDebounced(query, 150)
  const service = partyType === 'customer' ? api.customers : api.suppliers

  const result = useQuery(
    () =>
      debounced.trim().length === 0
        ? Promise.resolve({ rows: [], total: 0 })
        : unwrap(service.list({ search: debounced.trim(), limit })),
    [debounced, limit, partyType]
  )

  const options = useMemo<ComboOption<Customer>[]>(
    () =>
      (result.data?.rows ?? []).map((party) => {
        const balance = format.balanceLabel(party.currentBalance, partyType)
        return {
          value: party,
          title: party.name,
          subtitle: party.phone ?? undefined,
          meta: balance.text
        }
      }),
    [result.data, partyType]
  )

  return { options, isLoading: result.isLoading }
}
