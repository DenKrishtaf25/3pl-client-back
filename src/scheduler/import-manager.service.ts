import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { StockImportService } from './stock-import.service'
import { RegistryImportService } from './registry-import.service'
import { OrderImportService } from './order-import.service'
import { AnalyticsImportService } from './analytics-import.service'
import { FinanceImportService } from './finance-import.service'
import { ComplaintsImportService } from './complaints-import.service'

@Injectable()
export class ImportManagerService implements OnModuleInit {
  private readonly logger = new Logger(ImportManagerService.name)
  private isInitialImportRunning = false
  private readonly IMPORT_INTERVAL_MS = 10 * 60 * 1000 // 10 минут
  private timeoutId: NodeJS.Timeout | null = null

  constructor(
    private readonly stockImportService: StockImportService,
    private readonly registryImportService: RegistryImportService,
    private readonly orderImportService: OrderImportService,
    private readonly analyticsImportService: AnalyticsImportService,
    private readonly financeImportService: FinanceImportService,
    private readonly complaintsImportService: ComplaintsImportService,
  ) {}

  onModuleInit() {
    this.logger.log('ImportManagerService инициализирован. Запуск последовательного импорта...')
    // Запускаем первый цикл импортов после небольшой задержки, чтобы приложение полностью запустилось
    setImmediate(() => {
      this.runInitialImportsSequence()
    })
  }

  /**
   * Запускает последовательный импорт всех таблиц при старте приложения
   */
  private async runInitialImportsSequence() {
    if (this.isInitialImportRunning) {
      this.logger.warn('Начальный импорт уже выполняется, пропускаем...')
      return
    }

    this.isInitialImportRunning = true
    const startTime = Date.now()

    try {
      this.logger.log('=== Начало последовательного импорта всех таблиц ===')

      // Порядок импорта: от меньших к большим таблицам (примерно)
      // Можно изменить порядок в зависимости от приоритета
      await this.runImport('complaints', () => this.complaintsImportService.handleComplaintsImport())
      await this.runImport('finance', () => this.financeImportService.handleFinanceImport())
      await this.runImport('analytics', () => this.analyticsImportService.handleAnalyticsImport())
      await this.runImport('orders', () => this.orderImportService.handleOrderImport())
      await this.runImport('registry', () => this.registryImportService.handleRegistryImport())
      await this.runImport('stock', () => this.stockImportService.handleStockImport())

      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)
      this.logger.log(`=== Последовательный импорт всех таблиц завершен за ${totalDuration} сек ===`)

      // Планируем следующий цикл импортов
      this.scheduleNextImportCycle()
    } catch (error) {
      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)
      this.logger.error(`Ошибка при последовательном импорте за ${totalDuration} сек:`, error)
      // Даже при ошибке планируем следующий цикл
      this.scheduleNextImportCycle()
    } finally {
      this.isInitialImportRunning = false
    }
  }

  /**
   * Выполняет один импорт с логированием
   */
  private async runImport(name: string, importFn: () => Promise<void>) {
    const startTime = Date.now()
    try {
      this.logger.log(`[${name}] Начинаем импорт...`)
      await importFn()
      const duration = ((Date.now() - startTime) / 1000).toFixed(1)
      this.logger.log(`[${name}] Импорт завершен за ${duration} сек`)
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1)
      this.logger.error(`[${name}] Ошибка при импорте за ${duration} сек:`, error)
      // Продолжаем выполнение следующих импортов даже при ошибке
    }
  }

  /**
   * Планирует следующий цикл импортов
   */
  private scheduleNextImportCycle() {
    // Отменяем предыдущий таймер, если он существует
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
    }

    // Планируем следующий цикл импортов через 10 минут
    this.timeoutId = setTimeout(() => {
      this.runInitialImportsSequence()
    }, this.IMPORT_INTERVAL_MS)

    const nextRunTime = new Date(Date.now() + this.IMPORT_INTERVAL_MS)
    this.logger.log(`Следующий цикл импортов запланирован на ${nextRunTime.toLocaleString()}`)
  }

  /**
   * Метод для ручного запуска цикла импортов
   */
  async runImportsManually() {
    if (this.isInitialImportRunning) {
      throw new Error('Импорт уже выполняется')
    }
    
    await this.runInitialImportsSequence()
  }
}

