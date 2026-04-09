import { Injectable, Logger } from '@nestjs/common'

@Injectable()
export class OrdersOnlineLockService {
  private readonly logger = new Logger(OrdersOnlineLockService.name)
  private isLocked = false
  private owner: string | null = null

  tryAcquire(owner: string): boolean {
    if (this.isLocked) {
      this.logger.warn(
        `Импорт orders_online уже выполняется (${this.owner ?? 'unknown'}), пропускаем запуск от ${owner}`,
      )
      return false
    }

    this.isLocked = true
    this.owner = owner
    return true
  }

  release(owner: string): void {
    if (!this.isLocked) {
      return
    }

    if (this.owner && this.owner !== owner) {
      this.logger.warn(
        `Попытка снять lock orders_online не владельцем: ${owner}, текущий владелец: ${this.owner}`,
      )
      return
    }

    this.isLocked = false
    this.owner = null
  }
}
