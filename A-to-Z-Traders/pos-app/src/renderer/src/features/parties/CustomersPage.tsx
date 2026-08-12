import type { JSX } from 'react'
import { PartyListPage } from './PartyListPage'

export function CustomersPage(): JSX.Element {
  return <PartyListPage partyType="customer" />
}
