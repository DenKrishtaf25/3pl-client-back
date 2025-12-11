import { Injectable, Logger } from '@nestjs/common'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

@Injectable()
export class RegistryImportService {
  private readonly logger = new Logger(RegistryImportService.name)
  private isRunning = false

  async handleRegistryImport() {
    if (this.isRunning) {
      this.logger.warn('Импорт registry уже выполняется, пропускаем...')
      return
    }

    this.isRunning = true
    const startTime = Date.now()
    
    try {
      this.logger.log('Начинаем автоматический импорт registry...')
      
      // Определяем команду в зависимости от окружения
      const isProduction = process.env.NODE_ENV === 'production'
      const command = isProduction 
        ? 'npm run import:registry:prod'
        : 'npm run import:registry'

      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        maxBuffer: 10 * 1024 * 1024, // 10MB
      })

      const duration = ((Date.now() - startTime) / 1000).toFixed(1)
      
      if (stderr) {
        this.logger.warn(`Импорт registry завершен с предупреждениями за ${duration} сек`)
        this.logger.debug(stderr)
      } else {
        this.logger.log(`Импорт registry успешно завершен за ${duration} сек`)
      }
      
      if (stdout) {
        // Логируем последние строки вывода
        const lines = stdout.split('\n').filter(line => line.trim())
        const lastLines = lines.slice(-10)
        this.logger.debug('Последние строки вывода:\n' + lastLines.join('\n'))
      }
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1)
      this.logger.error(`Ошибка при импорте registry за ${duration} сек:`, error)
      
      if (error instanceof Error) {
        this.logger.error(`Сообщение об ошибке: ${error.message}`)
        if ('stderr' in error && error.stderr) {
          this.logger.error(`Stderr: ${error.stderr}`)
        }
      }
    } finally {
      this.isRunning = false
      // Планирование следующего импорта теперь управляется ImportManagerService
    }
  }

  // Метод для ручного запуска импорта
  async importRegistryManually() {
    if (this.isRunning) {
      throw new Error('Импорт registry уже выполняется')
    }
    
    await this.handleRegistryImport()
  }
}

