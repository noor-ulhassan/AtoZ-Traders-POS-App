import { IPC_CHANNELS } from '@shared/ipc'
import * as expenseService from '../../services/expenseService'
import * as paymentService from '../../services/paymentService'
import { noInput, registerHandler } from '../registry'
import {
  expenseAddSchema,
  expenseCategoryAddSchema,
  expenseDeleteSchema,
  expenseFiltersSchema,
  expenseUpdateSchema,
  paymentCreateSchema,
  paymentDeleteSchema,
  paymentFiltersSchema
} from '../schemas/money'

export function registerMoneyHandlers(): void {
  // ---- payments
  registerHandler(IPC_CHANNELS.paymentsCreate, paymentCreateSchema, ({ input }) =>
    paymentService.createPayment(input)
  )
  registerHandler(IPC_CHANNELS.paymentsList, paymentFiltersSchema, (filters) =>
    paymentService.listPayments(filters)
  )
  registerHandler(IPC_CHANNELS.paymentsDelete, paymentDeleteSchema, ({ id }) =>
    paymentService.removePayment(id)
  )

  // ---- expenses
  registerHandler(IPC_CHANNELS.expenseCategoriesList, noInput, () =>
    expenseService.listExpenseCategories()
  )
  registerHandler(IPC_CHANNELS.expenseCategoriesAdd, expenseCategoryAddSchema, ({ name }) =>
    expenseService.addExpenseCategory(name)
  )
  registerHandler(IPC_CHANNELS.expensesList, expenseFiltersSchema, (filters) =>
    expenseService.listExpenses(filters)
  )
  registerHandler(IPC_CHANNELS.expensesAdd, expenseAddSchema, ({ input }) =>
    expenseService.addExpense(input)
  )
  registerHandler(IPC_CHANNELS.expensesUpdate, expenseUpdateSchema, ({ id, input }) =>
    expenseService.updateExpense(id, input)
  )
  registerHandler(IPC_CHANNELS.expensesDelete, expenseDeleteSchema, ({ id }) =>
    expenseService.removeExpense(id)
  )
}
