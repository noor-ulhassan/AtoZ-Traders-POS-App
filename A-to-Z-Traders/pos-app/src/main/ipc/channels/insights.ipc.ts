import { IPC_CHANNELS } from '@shared/ipc'
import * as dashboardService from '../../services/dashboardService'
import * as exportService from '../../services/exportService'
import * as reportService from '../../services/reportService'
import { noInput, registerHandler } from '../registry'
import { dateRangeSchema } from '../schemas/common'
import { exportSchema } from '../schemas/money'

export function registerInsightsHandlers(): void {
  registerHandler(IPC_CHANNELS.reportsProfitLoss, dateRangeSchema, (range) =>
    reportService.profitAndLoss(range)
  )
  registerHandler(IPC_CHANNELS.reportsStockValuation, noInput, () => reportService.stockValuation())
  registerHandler(IPC_CHANNELS.reportsLowStock, noInput, () => reportService.lowStock())
  registerHandler(IPC_CHANNELS.reportsSalesSummary, dateRangeSchema, (range) =>
    reportService.salesSummary(range)
  )
  registerHandler(IPC_CHANNELS.reportsProductProfit, dateRangeSchema, (range) =>
    reportService.productProfit(range)
  )

  registerHandler(IPC_CHANNELS.dashboardSummary, dateRangeSchema, (range) =>
    dashboardService.getSummary(range)
  )

  registerHandler(IPC_CHANNELS.exportCsv, exportSchema, (request) =>
    exportService.exportCsv(request)
  )
}
