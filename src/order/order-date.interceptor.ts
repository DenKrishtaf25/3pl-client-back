import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

@Injectable()
export class OrderDateInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map(data => {
        // Рекурсивно трансформируем даты в ответе
        return this.transformDates(data)
      })
    )
  }

  private transformDates(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj
    }

    if (obj instanceof Date) {
      // Если это Date объект, конвертируем его в строку без 'Z'
      // Добавляем 3 часа к UTC времени, чтобы получить локальное время из CSV
      const year = obj.getUTCFullYear()
      const month = String(obj.getUTCMonth() + 1).padStart(2, '0')
      const day = String(obj.getUTCDate()).padStart(2, '0')
      const hours = String(obj.getUTCHours() + 3).padStart(2, '0')
      const minutes = String(obj.getUTCMinutes()).padStart(2, '0')
      const seconds = String(obj.getUTCSeconds()).padStart(2, '0')
      return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.transformDates(item))
    }

    if (typeof obj === 'object') {
      const transformed: any = {}
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          // Трансформируем только поля с датами
          if ((key === 'exportDate' || key === 'shipmentDate' || key === 'acceptanceDate') && obj[key] instanceof Date) {
            transformed[key] = this.transformDates(obj[key])
          } else {
            transformed[key] = this.transformDates(obj[key])
          }
        }
      }
      return transformed
    }

    return obj
  }
}

