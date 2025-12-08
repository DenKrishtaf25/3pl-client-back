import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

@Injectable()
export class ComplaintsImportService implements OnModuleInit {
  private readonly logger = new Logger(ComplaintsImportService.name)
  private isRunning = false
  private timeoutId: NodeJS.Timeout | null = null
  private readonly IMPORT_INTERVAL_MS = 10 * 60 * 1000 // 10 минут

  onModuleInit() {
    // Запускаем первый импорт сразу при старте приложения
    this.logger.log('Планировщик импорта complaints инициализирован. Запуск первого импорта...')
    // Запускаем импорт асинхронно, чтобы не блокировать инициализацию модуля
    setImmediate(() => {
      this.handleComplaintsImport()
    })
  }

  private scheduleNextImport() {
    // Отменяем предыдущий таймер, если он существует
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
    }

    // Планируем следующий импорт через 10 минут
    this.timeoutId = setTimeout(() => {
      this.handleComplaintsImport()
    }, this.IMPORT_INTERVAL_MS)

    const nextRunTime = new Date(Date.now() + this.IMPORT_INTERVAL_MS)
    this.logger.log(`Следующий импорт complaints запланирован на ${nextRunTime.toLocaleString()}`)
  }

  async handleComplaintsImport() {
    if (this.isRunning) {
      this.logger.warn('Импорт complaints уже выполняется, пропускаем...')
      return
    }

    this.isRunning = true
    const startTime = Date.now()
    
    try {
      this.logger.log('Начинаем автоматический импорт complaints...')
      
      // Определяем команду в зависимости от окружения
      const isProduction = process.env.NODE_ENV === 'production'
      const command = isProduction 
        ? 'npm run import:complaints:prod'
        : 'npm run import:complaints'

      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        maxBuffer: 10 * 1024 * 1024, // 10MB
      })

      const duration = ((Date.now() - startTime) / 1000).toFixed(1)
      
      if (stderr) {
        this.logger.warn(`Импорт complaints завершен с предупреждениями за ${duration} сек`)
        this.logger.debug(stderr)
      } else {
        this.logger.log(`Импорт complaints успешно завершен за ${duration} сек`)
      }
      
      if (stdout) {
        // Логируем последние строки вывода
        const lines = stdout.split('\n').filter(line => line.trim())
        const lastLines = lines.slice(-10)
        this.logger.debug('Последние строки вывода:\n' + lastLines.join('\n'))
      }
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1)
      this.logger.error(`Ошибка при импорте complaints за ${duration} сек:`, error)
      
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
  async importComplaintsManually() {
    if (this.isRunning) {
      throw new Error('Импорт complaints уже выполняется')
    }
    
    await this.handleComplaintsImport()
  }
}

