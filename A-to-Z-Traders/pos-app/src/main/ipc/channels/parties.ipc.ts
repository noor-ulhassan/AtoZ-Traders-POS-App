import { IPC_CHANNELS } from '@shared/ipc'
import * as ledgerService from '../../services/ledgerService'
import { customers, suppliers } from '../../services/partyService'
import { registerHandler } from '../registry'
import {
  ledgerSchema,
  partyAddSchema,
  partyFiltersSchema,
  partyGetSchema,
  partyUpdateSchema
} from '../schemas/parties'

export function registerPartyHandlers(): void {
  // ---- customers
  registerHandler(IPC_CHANNELS.customersList, partyFiltersSchema, (filters) =>
    customers.list(filters)
  )
  registerHandler(IPC_CHANNELS.customersGet, partyGetSchema, ({ id }) => customers.get(id))
  registerHandler(IPC_CHANNELS.customersAdd, partyAddSchema, ({ input }) => customers.add(input))
  registerHandler(IPC_CHANNELS.customersUpdate, partyUpdateSchema, ({ id, input }) =>
    customers.update(id, input)
  )
  registerHandler(IPC_CHANNELS.customersLedger, ledgerSchema, ({ id, range }) =>
    ledgerService.getStatement('customer', id, range)
  )

  // ---- suppliers
  registerHandler(IPC_CHANNELS.suppliersList, partyFiltersSchema, (filters) =>
    suppliers.list(filters)
  )
  registerHandler(IPC_CHANNELS.suppliersGet, partyGetSchema, ({ id }) => suppliers.get(id))
  registerHandler(IPC_CHANNELS.suppliersAdd, partyAddSchema, ({ input }) => suppliers.add(input))
  registerHandler(IPC_CHANNELS.suppliersUpdate, partyUpdateSchema, ({ id, input }) =>
    suppliers.update(id, input)
  )
  registerHandler(IPC_CHANNELS.suppliersLedger, ledgerSchema, ({ id, range }) =>
    ledgerService.getStatement('supplier', id, range)
  )
}
