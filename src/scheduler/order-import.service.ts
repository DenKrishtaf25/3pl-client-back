import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

@Injectable()
export class OrderImportService implements OnModuleInit {
  private readonly logger = new Logger(OrderImportService.name)
  private isRunning = false
  private timeoutId: NodeJS.Timeout | null = null
  private readonly IMPORT_INTERVAL_MS = 10 * 60 * 1000 // 10 минут

  onModuleInit() {
    // Запускаем первый импорт сразу при старте приложения
    this.logger.log('Планировщик импорта orders инициализирован. Запуск первого импорта...')
    // Запускаем импорт асинхронно, чтобы не блокировать инициализацию модуля
    setImmediate(() => {
      this.handleOrderImport()
    })
  }

  private scheduleNextImport() {
    // Отменяем предыдущий таймер, если он существует
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
    }

    // Планируем следующий импорт через 10 минут
    this.timeoutId = setTimeout(() => {
      this.handleOrderImport()
    }, this.IMPORT_INTERVAL_MS)

    const nextRunTime = new Date(Date.now() + this.IMPORT_INTERVAL_MS)
    this.logger.log(`Следующий импорт orders запланирован на ${nextRunTime.toLocaleString()}`)
  }

  async handleOrderImport() {
    if (this.isRunning) {
      this.logger.warn('Импорт orders уже выполняется, пропускаем...')
      return
    }

    this.isRunning = true
    const startTime = Date.now()
    
    try {
      this.logger.log('Начинаем автоматический импорт orders...')
      
      // Определяем команду в зависимости от окружения
      const isProduction = process.env.NODE_ENV === 'production'
      const command = isProduction 
        ? 'npm run import:orders:prod'
        : 'npm run import:orders'

      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        maxBuffer: 10 * 1024 * 1024, // 10MB
      })

      const duration = ((Date.now() - startTime) / 1000).toFixed(1)
      
      if (stderr) {
        this.logger.warn(`Импорт orders завершен с предупреждениями за ${duration} сек`)
        this.logger.debug(stderr)
      } else {
        this.logger.log(`Импорт orders успешно завершен за ${duration} сек`)
      }
      
      if (stdout) {
        // Логируем последние строки вывода
        const lines = stdout.split('\n').filter(line => line.trim())
        const lastLines = lines.slice(-10)
        this.logger.debug('Последние строки вывода:\n' + lastLines.join('\n'))
      }
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1)
      this.logger.error(`Ошибка при импорте orders за ${duration} сек:`, error)
      
      if (error instanceof Error) {
        this.logger.error(`Сообщение об ошибке: ${error.message}`)
        if ('stderr' in error && error.stderr) {
          this.logger.error(`Stderr: ${error.stderr}`)
        }
      }
    } finally {
      this.isRunning = false
      // Планируем следующий импорт после завершения (успешного или неуспешного)
      this.scheduleNextImport()
    }
  }

  // Метод для ручного запуска импорта
  async importOrderManually() {
    if (this.isRunning) {
      throw new Error('Импорт orders уже выполняется')
    }
    
    await this.handleOrderImport()
  }
}

